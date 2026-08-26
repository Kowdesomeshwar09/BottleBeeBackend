'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const { ComplianceRule } = require('../models');
const { AUDIT_ACTIONS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');
const complianceService = require('../services/compliance.service');

/**
 * Regional compliance rule administration.
 *
 * The rules configured here are what the compliance service enforces at
 * checkout, so every write is audited: changing a minimum age or lifting a dry
 * day is a legally significant act, and the platform must be able to show who
 * changed what and when.
 *
 * Rule *evaluation* lives in `services/compliance.service.js` because the cart,
 * order and age-verification controllers all depend on it.
 */

const SORTABLE = ['id', 'regionCode', 'regionName', 'minimumAge', 'createdAt', 'updatedAt'];

/* -------------------------------------------------------------------------- */
/*                          LIST COMPLIANCE RULES                             */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: SORTABLE,
      defaultSort: 'regionCode',
      defaultOrder: 'ASC',
    });

    const where = {};

    if (req.body.dryDay !== undefined && req.body.dryDay !== null) {
      where.dryDay = req.body.dryDay;
    }

    if (req.body.search) {
      where[Op.or] = [
        { regionCode: { [Op.like]: `%${req.body.search}%` } },
        { regionName: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await ComplianceRule.findAndCountAll({ where, limit, offset, order });

    return paginated(
      res,
      result.rows.map(complianceService.serializeRule),
      toPageMeta(result, { page, limit }),
      'Compliance rules fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching compliance rules', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        GET ONE COMPLIANCE RULE                             */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const rule = req.body.id
      ? await ComplianceRule.findByPk(req.body.id)
      : await ComplianceRule.findOne({
        where: { regionCode: String(req.body.regionCode).toUpperCase() },
      });

    if (!rule) return fail(res, 'Compliance rule not found', 404);

    return ok(res, complianceService.serializeRule(rule), 'Compliance rule fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching compliance rule', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                    CREATE OR UPDATE A COMPLIANCE RULE                      */
/* -------------------------------------------------------------------------- */
/**
 * Upsert keyed on `regionCode`. A soft-deleted rule for the same region is
 * restored rather than duplicated, because `region_code` is unique and a deleted
 * row would otherwise block ever re-configuring that region.
 */
const save = async (req, res) => {
  try {
    const regionCode = String(req.body.regionCode).toUpperCase();

    const existing = await ComplianceRule.findOne({
      where: { regionCode },
      paranoid: false,
    });

    const values = {
      regionCode,
      regionName: req.body.regionName ?? existing?.regionName ?? null,
      minimumAge: req.body.minimumAge ?? existing?.minimumAge ?? config.compliance.defaultMinimumAge,
      alcoholSaleStartTime: req.body.alcoholSaleStartTime ?? existing?.alcoholSaleStartTime ?? null,
      alcoholSaleEndTime: req.body.alcoholSaleEndTime ?? existing?.alcoholSaleEndTime ?? null,
      dryDay: req.body.dryDay ?? existing?.dryDay ?? false,
      maxOrderAmount: req.body.maxOrderAmount ?? existing?.maxOrderAmount ?? null,
      maxQuantityPerOrder: req.body.maxQuantityPerOrder ?? existing?.maxQuantityPerOrder ?? null,
      ruleMetadata: req.body.ruleMetadata ?? existing?.ruleMetadata ?? null,
      isActive: req.body.isActive ?? existing?.isActive ?? true,
    };

    let rule;
    let before = null;
    let isNew = false;

    if (existing) {
      before = complianceService.serializeRule(existing);
      if (existing.deletedAt) await existing.restore();
      rule = await existing.update({ ...values, updatedBy: req.user.id });
    } else {
      isNew = true;
      rule = await ComplianceRule.create({ ...values, createdBy: req.user.id });
    }

    await recordAudit({
      action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
      entityType: 'ComplianceRule',
      entityId: rule.id,
      oldValues: before,
      newValues: complianceService.serializeRule(rule),
      req,
    });

    const payload = complianceService.serializeRule(rule);

    return isNew
      ? created(res, payload, 'Compliance rule created successfully')
      : updated(res, payload, 'Compliance rule updated successfully');
  } catch (error) {
    return fail(res, 'Error saving compliance rule', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                         DELETE A COMPLIANCE RULE                           */
/* -------------------------------------------------------------------------- */
/**
 * Soft delete. Deleting a rule does not open a region up: addresses in a region
 * with no rule fall back to the conservative platform default, so removal can
 * never make a region more permissive by accident.
 */
const remove = async (req, res) => {
  try {
    const rule = await ComplianceRule.findByPk(req.body.id);
    if (!rule) return fail(res, 'Compliance rule not found', 404);

    const before = complianceService.serializeRule(rule);

    await rule.update({ deletedBy: req.user.id });
    await rule.destroy();

    await recordAudit({
      action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
      entityType: 'ComplianceRule',
      entityId: rule.id,
      oldValues: before,
      newValues: { deleted: true },
      req,
    });

    return deleted(res, 'Compliance rule deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting compliance rule', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        PUBLIC SERVICEABILITY PROBE                         */
/* -------------------------------------------------------------------------- */
const serviceability = async (req, res) => {
  try {
    const report = await complianceService.checkServiceability(req.body);
    return ok(res, report, 'Serviceability checked successfully');
  } catch (error) {
    return fail(res, 'Error checking serviceability', 500, [{ message: error.message }]);
  }
};

module.exports = { list, detail, save, remove, serviceability };
