'use strict';

const config = require('../config');
const logger = require('../config/logger');
const { ComplianceRule } = require('../models');
const AppError = require('../utils/AppError');
const { calculateAge, isWithinTimeWindow, toDateOnly } = require('../utils/dates');

/**
 * Regional alcohol compliance — SHARED SERVICE.
 *
 * This file holds only what more than one controller calls. Rule administration
 * (list / detail / save / delete) lives in `compliance.controller.js`, per the
 * project convention that business logic belongs to its controller.
 *
 * What stays here is the decision "may this sale legally happen?", because the
 * cart, order, age-verification and customer-address controllers all have to ask
 * it and must all get the same answer. Duplicating it would be the one way to
 * end up with a checkout that permits what the cart refused.
 *
 * Controls honoured per region:
 *   minimumAge                legal drinking age
 *   alcoholSaleStart/EndTime  permitted sale window (may wrap past midnight)
 *   dryDay                    region-wide prohibition switch
 *   maxOrderAmount            value cap per order
 *   maxQuantityPerOrder       unit cap per order
 *   ruleMetadata.dryDates     ['2026-01-26'] specific prohibition dates
 *   ruleMetadata.blockedTypes ['LIQUEUR'] product types not sellable here
 *   ruleMetadata.states       ['Telangana'] resolves a region from an address
 */

/**
 * Applied when no rule row matches. Deliberately conservative: an unconfigured
 * region must never end up more permissive than a configured one.
 */
function fallbackRule() {
  return {
    regionCode: config.compliance.defaultRegionCode,
    regionName: 'Platform default',
    minimumAge: config.compliance.defaultMinimumAge,
    alcoholSaleStartTime: null,
    alcoholSaleEndTime: null,
    dryDay: false,
    maxOrderAmount: null,
    maxQuantityPerOrder: null,
    ruleMetadata: null,
    isFallback: true,
  };
}

/**
 * Resolves which region governs an address.
 * An explicit `regionCode` wins; otherwise the address state is matched against
 * `ruleMetadata.states`; otherwise the configured default applies.
 */
async function resolveRegionCode(address) {
  if (!address) return config.compliance.defaultRegionCode;
  if (address.regionCode) return String(address.regionCode).toUpperCase();

  if (address.state) {
    const rules = await ComplianceRule.findAll({ where: { isActive: true } });
    const match = rules.find((rule) => {
      const states = rule.ruleMetadata?.states;
      return Array.isArray(states)
        && states.some((s) => String(s).toLowerCase() === String(address.state).toLowerCase());
    });
    if (match) return match.regionCode;
  }

  return config.compliance.defaultRegionCode;
}

/** The rule row for a region, or the conservative fallback. */
async function getRule(regionCode) {
  if (!regionCode) return fallbackRule();

  const rule = await ComplianceRule.findOne({
    where: { regionCode: String(regionCode).toUpperCase(), isActive: true },
  });

  if (!rule) {
    logger.warn('No compliance rule configured for region %s — applying platform default', regionCode);
    return fallbackRule();
  }
  return rule;
}

/**
 * Evaluates an order against a region's rules and returns a report.
 *
 * Deliberately does not throw: the cart screen calls this to preview eligibility
 * and needs every blocking reason at once, not just the first.
 *
 * @param {object} input
 * @param {object} input.address          delivery address (state / regionCode)
 * @param {string|Date} input.dateOfBirth customer date of birth
 * @param {boolean} input.ageVerified     approved age verification on file
 * @param {number} input.totalQuantity    units in the order
 * @param {number} input.grandTotal       order value
 * @param {string[]} input.productTypes   product types present in the order
 * @param {Date} [input.reference]        evaluation instant, for testing
 */
async function evaluateOrder(input) {
  const reference = input.reference || new Date();
  const regionCode = await resolveRegionCode(input.address);
  const rule = await getRule(regionCode);
  const regionLabel = rule.regionName || regionCode;

  const violations = [];

  // --- Age ----------------------------------------------------------------
  const age = calculateAge(input.dateOfBirth, reference);

  if (age === null) {
    violations.push({
      code: 'DOB_MISSING',
      message: 'A date of birth is required before alcohol can be sold to this account.',
    });
  } else if (age < rule.minimumAge) {
    violations.push({
      code: 'UNDER_AGE',
      message: `The legal drinking age in ${regionLabel} is ${rule.minimumAge}. This account is ${age}.`,
      minimumAge: rule.minimumAge,
      age,
    });
  }

  if (!input.ageVerified) {
    violations.push({
      code: 'AGE_NOT_VERIFIED',
      message: 'Your identity document must be verified before you can place an order.',
    });
  }

  // --- Prohibition --------------------------------------------------------
  if (rule.dryDay) {
    violations.push({
      code: 'DRY_DAY',
      message: `Alcohol sales are currently suspended in ${regionLabel}.`,
    });
  }

  const dryDates = rule.ruleMetadata?.dryDates;
  if (Array.isArray(dryDates) && dryDates.includes(toDateOnly(reference))) {
    violations.push({
      code: 'DRY_DATE',
      message: `${toDateOnly(reference)} is a dry day in ${regionLabel}. Sales are not permitted.`,
    });
  }

  // --- Sale window --------------------------------------------------------
  if (!isWithinTimeWindow(rule.alcoholSaleStartTime, rule.alcoholSaleEndTime, reference)) {
    violations.push({
      code: 'OUTSIDE_SALE_WINDOW',
      message: `Alcohol can only be sold between ${rule.alcoholSaleStartTime} and ${rule.alcoholSaleEndTime} in ${regionLabel}.`,
      window: { from: rule.alcoholSaleStartTime, to: rule.alcoholSaleEndTime },
    });
  }

  // --- Caps ---------------------------------------------------------------
  if (rule.maxQuantityPerOrder && input.totalQuantity > rule.maxQuantityPerOrder) {
    violations.push({
      code: 'QUANTITY_LIMIT_EXCEEDED',
      message: `A single order in ${regionLabel} may contain at most ${rule.maxQuantityPerOrder} units. This order has ${input.totalQuantity}.`,
      limit: rule.maxQuantityPerOrder,
    });
  }

  if (rule.maxOrderAmount && Number(input.grandTotal) > Number(rule.maxOrderAmount)) {
    violations.push({
      code: 'VALUE_LIMIT_EXCEEDED',
      message: `A single order in ${regionLabel} may not exceed ${rule.maxOrderAmount}. This order is ${input.grandTotal}.`,
      limit: Number(rule.maxOrderAmount),
    });
  }

  // --- Blocked product types ---------------------------------------------
  const blockedTypes = rule.ruleMetadata?.blockedTypes;
  if (Array.isArray(blockedTypes) && input.productTypes?.length) {
    const blocked = [...new Set(input.productTypes.filter((t) => blockedTypes.includes(t)))];
    if (blocked.length) {
      violations.push({
        code: 'PRODUCT_TYPE_BLOCKED',
        message: `These product types cannot be sold in ${regionLabel}: ${blocked.join(', ')}.`,
        blocked,
      });
    }
  }

  return {
    compliant: violations.length === 0,
    regionCode: rule.regionCode || regionCode,
    regionName: rule.regionName || null,
    appliedRule: {
      minimumAge: rule.minimumAge,
      dryDay: rule.dryDay,
      saleWindow: { from: rule.alcoholSaleStartTime, to: rule.alcoholSaleEndTime },
      maxOrderAmount: rule.maxOrderAmount === null ? null : Number(rule.maxOrderAmount),
      maxQuantityPerOrder: rule.maxQuantityPerOrder,
      isFallback: !!rule.isFallback,
    },
    violations,
  };
}

/**
 * The checkout gate. Throws 403 COMPLIANCE_BLOCKED with every violation
 * attached, so the client can render all of them.
 */
async function assertOrderCompliant(input) {
  const report = await evaluateOrder(input);
  if (!report.compliant) {
    throw AppError.compliance(report.violations[0].message, report.violations);
  }
  return report;
}

/**
 * Serviceability probe for a location, without an order.
 * Shared because both the public compliance endpoint and the customer's
 * saved-address check use it.
 */
async function checkServiceability(location) {
  const regionCode = await resolveRegionCode(location);
  const rule = await getRule(regionCode);

  const withinWindow = isWithinTimeWindow(rule.alcoholSaleStartTime, rule.alcoholSaleEndTime);
  const isDryToday = rule.dryDay
    || (Array.isArray(rule.ruleMetadata?.dryDates)
      && rule.ruleMetadata.dryDates.includes(toDateOnly(new Date())));

  return {
    regionCode: rule.regionCode || regionCode,
    regionName: rule.regionName || null,
    serviceable: !isDryToday && withinWindow,
    minimumAge: rule.minimumAge,
    dryDay: isDryToday,
    withinSaleWindow: withinWindow,
    saleWindow: { from: rule.alcoholSaleStartTime, to: rule.alcoholSaleEndTime },
    maxOrderAmount: rule.maxOrderAmount === null ? null : Number(rule.maxOrderAmount),
    maxQuantityPerOrder: rule.maxQuantityPerOrder,
  };
}

/** Shared because the compliance and customer controllers both return rules. */
function serializeRule(rule) {
  return {
    id: rule.id,
    regionCode: rule.regionCode,
    regionName: rule.regionName,
    minimumAge: rule.minimumAge,
    alcoholSaleStartTime: rule.alcoholSaleStartTime,
    alcoholSaleEndTime: rule.alcoholSaleEndTime,
    dryDay: rule.dryDay,
    maxOrderAmount: rule.maxOrderAmount === null ? null : Number(rule.maxOrderAmount),
    maxQuantityPerOrder: rule.maxQuantityPerOrder,
    ruleMetadata: rule.ruleMetadata,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

module.exports = {
  fallbackRule,
  resolveRegionCode,
  getRule,
  evaluateOrder,
  assertOrderCompliant,
  checkServiceability,
  serializeRule,
};
