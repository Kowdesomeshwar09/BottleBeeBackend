'use strict';

const { Op } = require('sequelize');

const { Coupon, CouponUsage, Vendor } = require('../models');
const { DISCOUNT_TYPE, COUPON_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const money = require('../utils/money');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');
const promotionService = require('../services/promotion.service');

/**
 * Coupon administration.
 *
 * Validation and redemption live in `services/promotion.service.js`, because the
 * cart and order controllers both depend on them and must agree exactly.
 *
 * The rule worth knowing: a coupon that has already been redeemed is never hard
 * deleted, and its usage limit can never be lowered below the number of
 * redemptions already recorded. Redemption history has to stay reconcilable
 * against the orders that consumed it.
 */

const SORTABLE = ['id', 'code', 'startsAt', 'endsAt', 'usageCount', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serialize = (coupon, extra = {}) => ({
  id: coupon.id,
  code: coupon.code,
  title: coupon.title,
  description: coupon.description,
  discountType: coupon.discountType,
  discountValue: Number(coupon.discountValue),
  maxDiscountAmount: coupon.maxDiscountAmount === null ? null : Number(coupon.maxDiscountAmount),
  minOrderAmount: coupon.minOrderAmount === null ? null : Number(coupon.minOrderAmount),
  usageLimit: coupon.usageLimit,
  usageLimitPerUser: coupon.usageLimitPerUser,
  usageCount: coupon.usageCount,
  vendorId: coupon.vendorId,
  startsAt: coupon.startsAt,
  endsAt: coupon.endsAt,
  status: coupon.status,
  isActive: coupon.isActive,
  createdAt: coupon.createdAt,
  ...extra,
});

/** A percentage coupon over 100 would pay the customer to order. */
const percentageOutOfRange = (discountType, discountValue) =>
  discountType === DISCOUNT_TYPE.PERCENTAGE && Number(discountValue) > 100;

/* -------------------------------------------------------------------------- */
/*                               LIST COUPONS                                 */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.vendorId) where.vendorId = req.body.vendorId;
    if (req.body.discountType) where.discountType = req.body.discountType;

    if (req.body.activeNow) {
      const now = new Date();
      where.status = COUPON_STATUS.ACTIVE;
      where.startsAt = { [Op.lte]: now };
      where.endsAt = { [Op.gte]: now };
    }

    if (req.body.search) {
      where[Op.or] = [
        { code: { [Op.like]: `%${req.body.search}%` } },
        { title: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await Coupon.findAndCountAll({
      where,
      include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName'], required: false }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((c) => serialize(c, {
        vendor: c.vendor ? { id: c.vendor.id, businessName: c.vendor.businessName } : null,
      })),
      toPageMeta(result, { page, limit }),
      'Coupons fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching coupons', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              GET ONE COUPON                                */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const coupon = await Coupon.findByPk(req.body.id, {
      include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName'], required: false }],
    });
    if (!coupon) return fail(res, 'Coupon not found', 404);

    const redemptions = await CouponUsage.count({ where: { couponId: coupon.id } });

    return ok(
      res,
      serialize(coupon, {
        vendor: coupon.vendor
          ? { id: coupon.vendor.id, businessName: coupon.vendor.businessName }
          : null,
        redemptions,
        remainingRedemptions: coupon.usageLimit === null
          ? null
          : Math.max(coupon.usageLimit - coupon.usageCount, 0),
      }),
      'Coupon fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching coupon', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             CREATE A COUPON                                */
/* -------------------------------------------------------------------------- */
const create = async (req, res) => {
  try {
    const code = String(req.body.code).trim().toUpperCase();

    const existing = await Coupon.findOne({ where: { code }, paranoid: false, attributes: ['id'] });
    if (existing) return fail(res, 'A coupon with this code already exists', 409);

    if (req.body.vendorId) {
      const vendor = await Vendor.findByPk(req.body.vendorId);
      if (!vendor) return fail(res, 'Store does not exist', 400);
    }

    if (percentageOutOfRange(req.body.discountType, req.body.discountValue)) {
      return fail(res, 'A percentage discount cannot exceed 100', 422, [
        { field: 'discountValue', message: 'Must be 100 or less for a percentage coupon' },
      ]);
    }

    const coupon = await Coupon.create({
      code,
      title: req.body.title,
      description: req.body.description || null,
      discountType: req.body.discountType,
      discountValue: req.body.discountValue,
      maxDiscountAmount: req.body.maxDiscountAmount ?? null,
      minOrderAmount: req.body.minOrderAmount ?? null,
      usageLimit: req.body.usageLimit ?? null,
      usageLimitPerUser: req.body.usageLimitPerUser ?? null,
      vendorId: req.body.vendorId ?? null,
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt,
      status: req.body.status || COUPON_STATUS.ACTIVE,
      createdBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
      entityType: 'Coupon',
      entityId: coupon.id,
      newValues: serialize(coupon),
      req,
    });

    return created(res, serialize(coupon), 'Coupon created successfully');
  } catch (error) {
    return fail(res, 'Error creating coupon', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             UPDATE A COUPON                                */
/* -------------------------------------------------------------------------- */
const update = async (req, res) => {
  try {
    const coupon = await Coupon.findByPk(req.body.id);
    if (!coupon) return fail(res, 'Coupon not found', 404);

    const before = serialize(coupon);

    const discountType = req.body.discountType ?? coupon.discountType;
    const discountValue = req.body.discountValue ?? coupon.discountValue;

    if (percentageOutOfRange(discountType, discountValue)) {
      return fail(res, 'A percentage discount cannot exceed 100', 422, [
        { field: 'discountValue', message: 'Must be 100 or less for a percentage coupon' },
      ]);
    }

    // Lowering the cap below what has already been redeemed would make the
    // usage history impossible to reconcile.
    if (
      req.body.usageLimit !== undefined
      && req.body.usageLimit !== null
      && req.body.usageLimit < coupon.usageCount
    ) {
      return fail(
        res,
        `This coupon has already been redeemed ${coupon.usageCount} time(s); the limit cannot be set below that`,
        400
      );
    }

    await coupon.update({
      title: req.body.title ?? coupon.title,
      description: req.body.description ?? coupon.description,
      discountType,
      discountValue,
      maxDiscountAmount: req.body.maxDiscountAmount === undefined
        ? coupon.maxDiscountAmount
        : req.body.maxDiscountAmount,
      minOrderAmount: req.body.minOrderAmount === undefined
        ? coupon.minOrderAmount
        : req.body.minOrderAmount,
      usageLimit: req.body.usageLimit === undefined ? coupon.usageLimit : req.body.usageLimit,
      usageLimitPerUser: req.body.usageLimitPerUser === undefined
        ? coupon.usageLimitPerUser
        : req.body.usageLimitPerUser,
      startsAt: req.body.startsAt ?? coupon.startsAt,
      endsAt: req.body.endsAt ?? coupon.endsAt,
      status: req.body.status ?? coupon.status,
      isActive: req.body.isActive ?? coupon.isActive,
      updatedBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
      entityType: 'Coupon',
      entityId: coupon.id,
      oldValues: before,
      newValues: serialize(coupon),
      req,
    });

    const redemptions = await CouponUsage.count({ where: { couponId: coupon.id } });
    return updated(res, serialize(coupon, { redemptions }), 'Coupon updated successfully');
  } catch (error) {
    return fail(res, 'Error updating coupon', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             DELETE A COUPON                                */
/* -------------------------------------------------------------------------- */
/** Soft delete and deactivate, so redemption history survives. */
const remove = async (req, res) => {
  try {
    const coupon = await Coupon.findByPk(req.body.id);
    if (!coupon) return fail(res, 'Coupon not found', 404);

    await coupon.update({
      status: COUPON_STATUS.INACTIVE,
      isActive: false,
      deletedBy: req.user.id,
    });
    await coupon.destroy();

    return deleted(res, 'Coupon deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting coupon', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                      COUPONS I CAN USE RIGHT NOW                           */
/* -------------------------------------------------------------------------- */
/**
 * For the cart screen. Returns platform-wide coupons plus any scoped to the
 * cart's store, each annotated with whether it currently applies and how much
 * more the customer would need to spend if it does not.
 */
const available = async (req, res) => {
  try {
    const now = new Date();
    const subtotal = Number(req.body.subtotal || 0);

    const coupons = await Coupon.findAll({
      where: {
        status: COUPON_STATUS.ACTIVE,
        isActive: true,
        startsAt: { [Op.lte]: now },
        endsAt: { [Op.gte]: now },
        [Op.or]: [
          { vendorId: null },
          ...(req.body.vendorId ? [{ vendorId: req.body.vendorId }] : []),
        ],
      },
      order: [['endsAt', 'ASC']],
      limit: 50,
    });

    const results = [];

    for (const coupon of coupons) {
      if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) continue;

      if (coupon.usageLimitPerUser !== null) {
        // eslint-disable-next-line no-await-in-loop
        const used = await CouponUsage.count({
          where: { couponId: coupon.id, userId: req.user.id },
        });
        if (used >= coupon.usageLimitPerUser) continue;
      }

      const meetsMinimum = coupon.minOrderAmount === null
        || subtotal >= Number(coupon.minOrderAmount);

      results.push(serialize(coupon, {
        applicable: meetsMinimum,
        estimatedDiscount: meetsMinimum
          ? promotionService.computeDiscount(coupon, subtotal)
          : 0,
        shortfall: meetsMinimum
          ? 0
          : money.round2(Number(coupon.minOrderAmount) - subtotal),
      }));
    }

    return ok(res, results, 'Available coupons fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching available coupons', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       EXPIRE COUPONS PAST THEIR WINDOW                     */
/* -------------------------------------------------------------------------- */
const expireLapsed = async (req, res) => {
  try {
    const [expired] = await Coupon.update(
      { status: COUPON_STATUS.EXPIRED, updatedBy: req.user.id },
      { where: { status: COUPON_STATUS.ACTIVE, endsAt: { [Op.lt]: new Date() } } }
    );

    return ok(res, { couponsExpired: expired }, 'Lapsed coupons expired');
  } catch (error) {
    return fail(res, 'Error expiring coupons', 500, [{ message: error.message }]);
  }
};

module.exports = { list, detail, create, update, remove, available, expireLapsed, serialize };
