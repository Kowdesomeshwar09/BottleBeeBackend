'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Coupon, CouponUsage, Promotion, Vendor, Category, Product,
} = require('../models');
const {
  DISCOUNT_TYPE, COUPON_STATUS, PROMOTION_TARGET_TYPE, AUDIT_ACTIONS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const money = require('../utils/money');

/**
 * Coupons and promotional banners.
 *
 * Coupon discounts are always computed server-side from the coupon row: the
 * client sends only a code, never an amount. `validateForCart` is the single
 * place that decides whether a code applies and what it is worth, so the cart
 * preview and the checkout that charges the card cannot disagree.
 *
 * Global usage limits are enforced with a conditional UPDATE on `usage_count`
 * inside the checkout transaction, so concurrent checkouts cannot together
 * exceed the cap.
 */

const COUPON_SORTABLE = ['id', 'code', 'startsAt', 'endsAt', 'usageCount', 'createdAt'];
const PROMOTION_SORTABLE = ['id', 'title', 'sortOrder', 'startsAt', 'endsAt', 'createdAt'];

function serializeCoupon(coupon, extra = {}) {
  return {
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
  };
}

function serializePromotion(promotion) {
  return {
    id: promotion.id,
    title: promotion.title,
    description: promotion.description,
    bannerUrl: promotion.bannerUrl,
    targetType: promotion.targetType,
    targetId: promotion.targetId,
    sortOrder: promotion.sortOrder,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    status: promotion.status,
    isActive: promotion.isActive,
  };
}

/**
 * The discount a coupon is worth against a subtotal.
 * A percentage coupon is capped by `maxDiscountAmount`, and no coupon may ever
 * exceed the subtotal — a discount can reduce an order to zero, never below.
 */
function computeDiscount(coupon, subtotal) {
  const base = Number(subtotal || 0);

  let discount = coupon.discountType === DISCOUNT_TYPE.PERCENTAGE
    ? money.percentOf(base, coupon.discountValue)
    : money.round2(coupon.discountValue);

  if (coupon.maxDiscountAmount !== null && coupon.maxDiscountAmount !== undefined) {
    discount = Math.min(discount, Number(coupon.maxDiscountAmount));
  }

  return money.atLeastZero(Math.min(discount, base));
}

/**
 * Validates a coupon code for a specific cart and returns what it is worth.
 *
 * @param {object} params
 * @param {string} params.code
 * @param {number} params.userId
 * @param {number} params.subtotal
 * @param {number} [params.vendorId]     cart vendor, for vendor-scoped coupons
 * @param {object} [params.transaction]
 */
async function validateForCart({ code, userId, subtotal, vendorId = null, transaction = null }) {
  const coupon = await Coupon.findOne({
    where: { code: String(code).trim().toUpperCase() },
    transaction,
  });

  if (!coupon || !coupon.isActive) {
    throw AppError.badRequest('That coupon code is not valid', [
      { field: 'couponCode', code: 'COUPON_NOT_FOUND' },
    ]);
  }

  if (coupon.status !== COUPON_STATUS.ACTIVE) {
    throw AppError.badRequest(`This coupon is ${coupon.status.toLowerCase()}`, [
      { field: 'couponCode', code: 'COUPON_INACTIVE' },
    ]);
  }

  const now = new Date();
  if (new Date(coupon.startsAt) > now) {
    throw AppError.badRequest(
      `This coupon is not valid until ${new Date(coupon.startsAt).toISOString().slice(0, 10)}`,
      [{ field: 'couponCode', code: 'COUPON_NOT_STARTED' }]
    );
  }
  if (new Date(coupon.endsAt) < now) {
    throw AppError.badRequest('This coupon has expired', [
      { field: 'couponCode', code: 'COUPON_EXPIRED' },
    ]);
  }

  if (coupon.vendorId && vendorId && Number(coupon.vendorId) !== Number(vendorId)) {
    throw AppError.badRequest('This coupon cannot be used with items from this store', [
      { field: 'couponCode', code: 'COUPON_WRONG_VENDOR' },
    ]);
  }

  if (coupon.minOrderAmount !== null && Number(subtotal) < Number(coupon.minOrderAmount)) {
    throw AppError.badRequest(
      `Spend at least ${coupon.minOrderAmount} to use this coupon`,
      [{
        field: 'couponCode',
        code: 'COUPON_MIN_ORDER_NOT_MET',
        minOrderAmount: Number(coupon.minOrderAmount),
        subtotal: Number(subtotal),
      }]
    );
  }

  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    throw AppError.badRequest('This coupon has been fully redeemed', [
      { field: 'couponCode', code: 'COUPON_LIMIT_REACHED' },
    ]);
  }

  if (coupon.usageLimitPerUser !== null) {
    const used = await CouponUsage.count({
      where: { couponId: coupon.id, userId },
      transaction,
    });
    if (used >= coupon.usageLimitPerUser) {
      throw AppError.badRequest(
        `You have already used this coupon ${used} time(s), which is the limit`,
        [{ field: 'couponCode', code: 'COUPON_USER_LIMIT_REACHED' }]
      );
    }
  }

  return { coupon, discount: computeDiscount(coupon, subtotal) };
}

/**
 * Records redemption inside the checkout transaction.
 * The conditional UPDATE on `usage_count` is what makes a global usage limit
 * safe under concurrency: if another checkout consumed the last redemption
 * first, this update matches no rows and the order is rejected.
 */
async function redeem({ coupon, userId, orderId, discountAmount, transaction, actorId = null }) {
  if (coupon.usageLimit !== null) {
    const [affected] = await Coupon.update(
      {
        usageCount: sequelize.literal('usage_count + 1'),
        updatedBy: actorId,
      },
      {
        where: { id: coupon.id, usageCount: { [Op.lt]: coupon.usageLimit } },
        transaction,
      }
    );

    if (affected === 0) {
      throw AppError.conflict('This coupon was fully redeemed while you were checking out', [
        { field: 'couponCode', code: 'COUPON_LIMIT_REACHED' },
      ]);
    }
  } else {
    await Coupon.update(
      { usageCount: sequelize.literal('usage_count + 1'), updatedBy: actorId },
      { where: { id: coupon.id }, transaction }
    );
  }

  return CouponUsage.create(
    {
      couponId: coupon.id,
      userId,
      orderId,
      discountAmount,
      usedAt: new Date(),
      createdBy: actorId,
    },
    { transaction }
  );
}

/** Reverses a redemption when an order is cancelled before fulfilment. */
async function releaseRedemption({ orderId, transaction, actorId = null }) {
  const usages = await CouponUsage.findAll({ where: { orderId }, transaction });
  if (!usages.length) return 0;

  for (const usage of usages) {
    // eslint-disable-next-line no-await-in-loop
    await Coupon.update(
      { usageCount: sequelize.literal('GREATEST(usage_count - 1, 0)'), updatedBy: actorId },
      { where: { id: usage.couponId }, transaction }
    );
    // eslint-disable-next-line no-await-in-loop
    await usage.update({ deletedBy: actorId }, { transaction });
    // eslint-disable-next-line no-await-in-loop
    await usage.destroy({ transaction });
  }

  return usages.length;
}

// ---------------------------------------------------------------------------
// Coupon administration
// ---------------------------------------------------------------------------

async function listCoupons(body) {
  const { page, limit, offset, order } = buildPagination(body, { sortable: COUPON_SORTABLE });

  const where = {};
  if (body.status) where.status = body.status;
  if (body.vendorId) where.vendorId = body.vendorId;
  if (body.discountType) where.discountType = body.discountType;
  if (body.activeNow) {
    const now = new Date();
    where.status = COUPON_STATUS.ACTIVE;
    where.startsAt = { [Op.lte]: now };
    where.endsAt = { [Op.gte]: now };
  }
  if (body.search) {
    where[Op.or] = [
      { code: { [Op.like]: `%${body.search}%` } },
      { title: { [Op.like]: `%${body.search}%` } },
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

  return {
    rows: result.rows.map((c) => serializeCoupon(c, {
      vendor: c.vendor ? { id: c.vendor.id, businessName: c.vendor.businessName } : null,
    })),
    meta: toPageMeta(result, { page, limit }),
  };
}

async function getCoupon(body) {
  const coupon = await Coupon.findByPk(body.id, {
    include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName'], required: false }],
  });
  if (!coupon) throw AppError.notFound('Coupon not found');

  const redemptions = await CouponUsage.count({ where: { couponId: coupon.id } });

  return serializeCoupon(coupon, {
    vendor: coupon.vendor ? { id: coupon.vendor.id, businessName: coupon.vendor.businessName } : null,
    redemptions,
    remainingRedemptions: coupon.usageLimit === null ? null : Math.max(coupon.usageLimit - coupon.usageCount, 0),
  });
}

async function createCoupon(body, req) {
  const code = String(body.code).trim().toUpperCase();

  const existing = await Coupon.findOne({ where: { code }, paranoid: false, attributes: ['id'] });
  if (existing) throw AppError.conflict('A coupon with this code already exists');

  if (body.vendorId) {
    const vendor = await Vendor.findByPk(body.vendorId);
    if (!vendor) throw AppError.badRequest('Store does not exist');
  }

  if (body.discountType === DISCOUNT_TYPE.PERCENTAGE && Number(body.discountValue) > 100) {
    throw AppError.validation('A percentage discount cannot exceed 100', [
      { field: 'discountValue', message: 'Must be 100 or less for a percentage coupon' },
    ]);
  }

  const coupon = await Coupon.create({
    code,
    title: body.title,
    description: body.description || null,
    discountType: body.discountType,
    discountValue: body.discountValue,
    maxDiscountAmount: body.maxDiscountAmount ?? null,
    minOrderAmount: body.minOrderAmount ?? null,
    usageLimit: body.usageLimit ?? null,
    usageLimitPerUser: body.usageLimitPerUser ?? null,
    vendorId: body.vendorId ?? null,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    status: body.status || COUPON_STATUS.ACTIVE,
    createdBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
    entityType: 'Coupon',
    entityId: coupon.id,
    newValues: serializeCoupon(coupon),
    req,
  });

  return serializeCoupon(coupon);
}

async function updateCoupon(body, req) {
  const coupon = await Coupon.findByPk(body.id);
  if (!coupon) throw AppError.notFound('Coupon not found');

  const before = serializeCoupon(coupon);

  const discountType = body.discountType ?? coupon.discountType;
  const discountValue = body.discountValue ?? coupon.discountValue;
  if (discountType === DISCOUNT_TYPE.PERCENTAGE && Number(discountValue) > 100) {
    throw AppError.validation('A percentage discount cannot exceed 100', [
      { field: 'discountValue', message: 'Must be 100 or less for a percentage coupon' },
    ]);
  }

  if (body.usageLimit !== undefined && body.usageLimit !== null && body.usageLimit < coupon.usageCount) {
    throw AppError.badRequest(
      `This coupon has already been redeemed ${coupon.usageCount} time(s); the limit cannot be set below that`
    );
  }

  await coupon.update({
    title: body.title ?? coupon.title,
    description: body.description ?? coupon.description,
    discountType,
    discountValue,
    maxDiscountAmount: body.maxDiscountAmount === undefined ? coupon.maxDiscountAmount : body.maxDiscountAmount,
    minOrderAmount: body.minOrderAmount === undefined ? coupon.minOrderAmount : body.minOrderAmount,
    usageLimit: body.usageLimit === undefined ? coupon.usageLimit : body.usageLimit,
    usageLimitPerUser: body.usageLimitPerUser === undefined ? coupon.usageLimitPerUser : body.usageLimitPerUser,
    startsAt: body.startsAt ?? coupon.startsAt,
    endsAt: body.endsAt ?? coupon.endsAt,
    status: body.status ?? coupon.status,
    isActive: body.isActive ?? coupon.isActive,
    updatedBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.COMPLIANCE_RULE_UPDATED,
    entityType: 'Coupon',
    entityId: coupon.id,
    oldValues: before,
    newValues: serializeCoupon(coupon),
    req,
  });

  return getCoupon({ id: coupon.id });
}

async function deleteCoupon(body, req) {
  const coupon = await Coupon.findByPk(body.id);
  if (!coupon) throw AppError.notFound('Coupon not found');

  // Redemption history must survive, so the coupon is deactivated rather than
  // removed once it has been used.
  await coupon.update({
    status: COUPON_STATUS.INACTIVE,
    isActive: false,
    deletedBy: req.user.id,
  });
  await coupon.destroy();

  return { deleted: true };
}

/** Coupons a customer can actually use right now, for the cart screen. */
async function availableCoupons(body, req) {
  const now = new Date();

  const coupons = await Coupon.findAll({
    where: {
      status: COUPON_STATUS.ACTIVE,
      isActive: true,
      startsAt: { [Op.lte]: now },
      endsAt: { [Op.gte]: now },
      [Op.or]: [
        { vendorId: null },
        ...(body.vendorId ? [{ vendorId: body.vendorId }] : []),
      ],
    },
    order: [['endsAt', 'ASC']],
    limit: 50,
  });

  const subtotal = Number(body.subtotal || 0);
  const results = [];

  for (const coupon of coupons) {
    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) continue;

    if (coupon.usageLimitPerUser !== null) {
      // eslint-disable-next-line no-await-in-loop
      const used = await CouponUsage.count({ where: { couponId: coupon.id, userId: req.user.id } });
      if (used >= coupon.usageLimitPerUser) continue;
    }

    const meetsMinimum = coupon.minOrderAmount === null || subtotal >= Number(coupon.minOrderAmount);

    results.push(serializeCoupon(coupon, {
      applicable: meetsMinimum,
      estimatedDiscount: meetsMinimum ? computeDiscount(coupon, subtotal) : 0,
      shortfall: meetsMinimum ? 0 : money.round2(Number(coupon.minOrderAmount) - subtotal),
    }));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Promotional banners
// ---------------------------------------------------------------------------

async function listPromotions(body) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: PROMOTION_SORTABLE,
    defaultSort: 'sortOrder',
    defaultOrder: 'ASC',
  });

  const where = {};
  if (body.status) where.status = body.status;
  if (body.targetType) where.targetType = body.targetType;
  if (body.activeNow) {
    const now = new Date();
    where.status = COUPON_STATUS.ACTIVE;
    where.startsAt = { [Op.lte]: now };
    where.endsAt = { [Op.gte]: now };
  }
  if (body.search) where.title = { [Op.like]: `%${body.search}%` };

  const result = await Promotion.findAndCountAll({ where, limit, offset, order });
  return { rows: result.rows.map(serializePromotion), meta: toPageMeta(result, { page, limit }) };
}

/** Live banners for the storefront home screen. */
async function activePromotions() {
  const now = new Date();

  const promotions = await Promotion.findAll({
    where: {
      status: COUPON_STATUS.ACTIVE,
      isActive: true,
      startsAt: { [Op.lte]: now },
      endsAt: { [Op.gte]: now },
    },
    order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']],
    limit: 20,
  });

  // Resolve the polymorphic target so the client can deep-link without a
  // second round trip per banner.
  return Promise.all(promotions.map(async (promotion) => {
    const base = serializePromotion(promotion);
    if (!promotion.targetId || promotion.targetType === PROMOTION_TARGET_TYPE.ALL) return base;

    const lookups = {
      [PROMOTION_TARGET_TYPE.CATEGORY]: () => Category.findByPk(promotion.targetId, { attributes: ['id', 'name', 'slug'] }),
      [PROMOTION_TARGET_TYPE.PRODUCT]: () => Product.findByPk(promotion.targetId, { attributes: ['id', 'name', 'slug', 'vendorId'] }),
      [PROMOTION_TARGET_TYPE.VENDOR]: () => Vendor.findByPk(promotion.targetId, { attributes: ['id', 'businessName'] }),
    };

    const target = lookups[promotion.targetType] ? await lookups[promotion.targetType]() : null;
    return { ...base, target: target ? target.toJSON() : null };
  }));
}

async function savePromotion(body, req) {
  if (body.targetType !== PROMOTION_TARGET_TYPE.ALL && !body.targetId) {
    throw AppError.validation('A target id is required for this target type', [
      { field: 'targetId', message: `Required when targetType is ${body.targetType}` },
    ]);
  }

  const existing = body.id ? await Promotion.findByPk(body.id) : null;
  if (body.id && !existing) throw AppError.notFound('Promotion not found');

  const values = {
    title: body.title,
    description: body.description || null,
    bannerUrl: body.bannerUrl || null,
    targetType: body.targetType,
    targetId: body.targetType === PROMOTION_TARGET_TYPE.ALL ? null : body.targetId,
    sortOrder: body.sortOrder ?? 0,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    status: body.status || COUPON_STATUS.ACTIVE,
  };

  if (existing) {
    await existing.update({ ...values, isActive: body.isActive ?? existing.isActive, updatedBy: req.user.id });
    return serializePromotion(existing);
  }

  const promotion = await Promotion.create({ ...values, createdBy: req.user.id });
  return serializePromotion(promotion);
}

async function deletePromotion(body, req) {
  const promotion = await Promotion.findByPk(body.id);
  if (!promotion) throw AppError.notFound('Promotion not found');

  await promotion.update({ isActive: false, deletedBy: req.user.id });
  await promotion.destroy();

  return { deleted: true };
}

/**
 * Marks coupons and promotions whose window has closed as EXPIRED.
 * Intended for a scheduled job; also exposed as an admin action.
 */
async function expireLapsed(req) {
  const now = new Date();

  const [coupons] = await Coupon.update(
    { status: COUPON_STATUS.EXPIRED, updatedBy: req?.user?.id ?? null },
    { where: { status: COUPON_STATUS.ACTIVE, endsAt: { [Op.lt]: now } } }
  );

  const [promotions] = await Promotion.update(
    { status: COUPON_STATUS.EXPIRED, updatedBy: req?.user?.id ?? null },
    { where: { status: COUPON_STATUS.ACTIVE, endsAt: { [Op.lt]: now } } }
  );

  return { couponsExpired: coupons, promotionsExpired: promotions };
}

module.exports = {
  computeDiscount,
  validateForCart,
  redeem,
  releaseRedemption,
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  availableCoupons,
  listPromotions,
  activePromotions,
  savePromotion,
  deletePromotion,
  expireLapsed,
  serializeCoupon,
  serializePromotion,
};
