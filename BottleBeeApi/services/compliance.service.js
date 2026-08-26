'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const logger = require('../config/logger');
const { ComplianceRule } = require('../models');
const { AUDIT_ACTIONS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const { calculateAge, isWithinTimeWindow, toDateOnly } = require('../utils/dates');

/**
 * Regional alcohol compliance.
 *
 * This is the single place that decides whether a sale is legal. Checkout,
 * order placement and payment confirmation all route through
 * `evaluateOrder` / `assertOrderCompliant`, so a rule change takes effect
 * everywhere at once and nothing can bypass it.
 *
 * Supported controls per region:
 *   minimumAge             legal drinking age
 *   alcoholSaleStart/End   permitted sale window (wrapping past midnight is fine)
 *   dryDay                 region-wide prohibition switch
 *   maxOrderAmount         value cap per order
 *   maxQuantityPerOrder    unit cap per order
 *   ruleMetadata.dryDates  ['2026-01-26'] specific prohibition dates
 *   ruleMetadata.blockedTypes ['LIQUEUR'] product types not sellable here
 *   ruleMetadata.states    ['Telangana'] used to resolve a region from an address
 */

const SORTABLE = ['id', 'regionCode', 'minimumAge', 'createdAt', 'updatedAt'];

/** Fallback used only when no rule row matches; deliberately conservative. */
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
 * Explicit `regionCode` wins; otherwise the address state is matched against
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

/** Rule row for a region, or the conservative fallback. */
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
 * Evaluates an order against a region's rules.
 * Returns a report rather than throwing, so callers can preview eligibility
 * (for example the cart screen) without triggering an error.
 *
 * @param {object} input
 * @param {object} input.address          delivery address (needs state/regionCode)
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

  const violations = [];

  // --- Age -----------------------------------------------------------------
  const age = calculateAge(input.dateOfBirth, reference);
  if (age === null) {
    violations.push({
      code: 'DOB_MISSING',
      message: 'A date of birth is required before alcohol can be sold to this account.',
    });
  } else if (age < rule.minimumAge) {
    violations.push({
      code: 'UNDER_AGE',
      message: `The legal drinking age in ${rule.regionName || regionCode} is ${rule.minimumAge}. This account is ${age}.`,
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

  // --- Dry day -------------------------------------------------------------
  if (rule.dryDay) {
    violations.push({
      code: 'DRY_DAY',
      message: `Alcohol sales are currently suspended in ${rule.regionName || regionCode}.`,
    });
  }

  const dryDates = rule.ruleMetadata?.dryDates;
  if (Array.isArray(dryDates) && dryDates.includes(toDateOnly(reference))) {
    violations.push({
      code: 'DRY_DATE',
      message: `${toDateOnly(reference)} is a dry day in ${rule.regionName || regionCode}. Sales are not permitted.`,
    });
  }

  // --- Sale window ---------------------------------------------------------
  if (!isWithinTimeWindow(rule.alcoholSaleStartTime, rule.alcoholSaleEndTime, reference)) {
    violations.push({
      code: 'OUTSIDE_SALE_WINDOW',
      message: `Alcohol can only be sold between ${rule.alcoholSaleStartTime} and ${rule.alcoholSaleEndTime} in ${rule.regionName || regionCode}.`,
      window: { from: rule.alcoholSaleStartTime, to: rule.alcoholSaleEndTime },
    });
  }

  // --- Caps ----------------------------------------------------------------
  if (rule.maxQuantityPerOrder && input.totalQuantity > rule.maxQuantityPerOrder) {
    violations.push({
      code: 'QUANTITY_LIMIT_EXCEEDED',
      message: `A single order in ${rule.regionName || regionCode} may contain at most ${rule.maxQuantityPerOrder} units. This order has ${input.totalQuantity}.`,
      limit: rule.maxQuantityPerOrder,
    });
  }

  if (rule.maxOrderAmount && Number(input.grandTotal) > Number(rule.maxOrderAmount)) {
    violations.push({
      code: 'VALUE_LIMIT_EXCEEDED',
      message: `A single order in ${rule.regionName || regionCode} may not exceed ${rule.maxOrderAmount}. This order is ${input.grandTotal}.`,
      limit: Number(rule.maxOrderAmount),
    });
  }

  // --- Blocked product types ----------------------------------------------
  const blockedTypes = rule.ruleMetadata?.blockedTypes;
  if (Array.isArray(blockedTypes) && input.productTypes?.length) {
    const blocked = [...new Set(input.productTypes.filter((t) => blockedTypes.includes(t)))];
    if (blocked.length) {
      violations.push({
        code: 'PRODUCT_TYPE_BLOCKED',
        message: `These product types cannot be sold in ${rule.regionName || regionCode}: ${blocked.join(', ')}.`,
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

/** Throws a 403 COMPLIANCE_BLOCKED when the order may not proceed. */
async function assertOrderCompliant(input) {
  const report = await evaluateOrder(input);
  if (!report.compliant) {
    throw AppError.compliance(report.violations[0].message, report.violations);
  }
  return report;
}

// ---------------------------------------------------------------------------
// Rule administration
// ---------------------------------------------------------------------------

function serialize(rule) {
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

async function list(body) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: SORTABLE,
    defaultSort: 'regionCode',
    defaultOrder: 'ASC',
  });

  const where = {};
  if (body.search) {
    where[Op.or] = [
      { regionCode: { [Op.like]: `%${body.search}%` } },
      { regionName: { [Op.like]: `%${body.search}%` } },
    ];
  }
  if (body.dryDay !== undefined && body.dryDay !== null) where.dryDay = body.dryDay;

  const result = await ComplianceRule.findAndCountAll({ where, limit, offset, order });
  return { rows: result.rows.map(serialize), meta: toPageMeta(result, { page, limit }) };
}

async function detail(body) {
  const rule = body.id
    ? await ComplianceRule.findByPk(body.id)
    : await ComplianceRule.findOne({ where: { regionCode: String(body.regionCode).toUpperCase() } });
  if (!rule) throw AppError.notFound('Compliance rule not found');
  return serialize(rule);
}

async function upsert(body, req) {
  const regionCode = String(body.regionCode).toUpperCase();
  const existing = await ComplianceRule.findOne({ where: { regionCode }, paranoid: false });

  const values = {
    regionCode,
    regionName: body.regionName ?? existing?.regionName ?? null,
    minimumAge: body.minimumAge ?? existing?.minimumAge ?? config.compliance.defaultMinimumAge,
    alcoholSaleStartTime: body.alcoholSaleStartTime ?? existing?.alcoholSaleStartTime ?? null,
    alcoholSaleEndTime: body.alcoholSaleEndTime ?? existing?.alcoholSaleEndTime ?? null,
    dryDay: body.dryDay ?? existing?.dryDay ?? false,
    maxOrderAmount: body.maxOrderAmount ?? existing?.maxOrderAmount ?? null,
    maxQuantityPerOrder: body.maxQuantityPerOrder ?? existing?.maxQuantityPerOrder ?? null,
    ruleMetadata: body.ruleMetadata ?? existing?.ruleMetadata ?? null,
    isActive: body.isActive ?? existing?.isActive ?? true,
  };

  let rule;
  let before = null;

  if (existing) {
    before = serialize(existing);
    if (existing.deletedAt) await existing.restore();
    rule = await existing.update({ ...values, updatedBy: req.user.id });
  } else {
    rule = await ComplianceRule.create({ ...values, createdBy: req.user.id });
  }

  await recordAudit({
    action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
    entityType: 'ComplianceRule',
    entityId: rule.id,
    oldValues: before,
    newValues: serialize(rule),
    req,
  });

  return serialize(rule);
}

async function remove(body, req) {
  const rule = await ComplianceRule.findByPk(body.id);
  if (!rule) throw AppError.notFound('Compliance rule not found');

  await rule.update({ deletedBy: req.user.id });
  await rule.destroy();

  await recordAudit({
    action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
    entityType: 'ComplianceRule',
    entityId: rule.id,
    oldValues: { regionCode: rule.regionCode },
    newValues: { deleted: true },
    req,
  });

  return { deleted: true };
}

/** Public-facing check used by the storefront before it shows a checkout button. */
async function checkServiceability(body) {
  const regionCode = await resolveRegionCode(body);
  const rule = await getRule(regionCode);

  const withinWindow = isWithinTimeWindow(rule.alcoholSaleStartTime, rule.alcoholSaleEndTime);
  const isDryToday = rule.dryDay
    || (Array.isArray(rule.ruleMetadata?.dryDates) && rule.ruleMetadata.dryDates.includes(toDateOnly(new Date())));

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

module.exports = {
  resolveRegionCode,
  getRule,
  evaluateOrder,
  assertOrderCompliant,
  list,
  detail,
  upsert,
  remove,
  checkServiceability,
  serialize,
  fallbackRule,
};
