'use strict';

const {
  Joi, requiredId, id, name, longText, url, money, futureDate, enumOf, listSchema,
} = require('./common');
const {
  DISCOUNT_TYPE, COUPON_STATUS, PROMOTION_TARGET_TYPE,
} = require('../config/constants');

/* ------------------------------- COUPONS ---------------------------------- */

const listCouponsSchema = listSchema({
  status: enumOf(COUPON_STATUS, 'status'),
  vendorId: id,
  discountType: enumOf(DISCOUNT_TYPE, 'discountType'),
  activeNow: Joi.boolean(),
});

const createCouponSchema = Joi.object({
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_-]{3,80}$/).required()
    .messages({ 'string.pattern.base': 'Coupon code may contain only A-Z, 0-9, dash and underscore' }),
  title: name(150).required(),
  description: longText,
  discountType: enumOf(DISCOUNT_TYPE, 'discountType').required(),
  discountValue: money.greater(0).required(),
  maxDiscountAmount: money.allow(null),
  minOrderAmount: money.allow(null),
  usageLimit: Joi.number().integer().min(1).max(1000000).allow(null),
  usageLimitPerUser: Joi.number().integer().min(1).max(1000).allow(null),
  // Null means the coupon applies platform-wide.
  vendorId: id.allow(null),
  startsAt: futureDate.required(),
  endsAt: futureDate.greater(Joi.ref('startsAt')).required()
    .messages({ 'date.greater': 'endsAt must be after startsAt' }),
  status: enumOf(COUPON_STATUS, 'status').default(COUPON_STATUS.ACTIVE),
});

const updateCouponSchema = Joi.object({
  id: requiredId(),
  title: name(150),
  description: longText,
  discountType: enumOf(DISCOUNT_TYPE, 'discountType'),
  discountValue: money.greater(0),
  maxDiscountAmount: money.allow(null),
  minOrderAmount: money.allow(null),
  usageLimit: Joi.number().integer().min(0).max(1000000).allow(null),
  usageLimitPerUser: Joi.number().integer().min(1).max(1000).allow(null),
  startsAt: futureDate,
  endsAt: futureDate,
  status: enumOf(COUPON_STATUS, 'status'),
  isActive: Joi.boolean(),
}).min(2);

/** Cart screen: which coupons apply to this subtotal and store? */
const availableCouponsSchema = Joi.object({
  subtotal: money.default(0),
  vendorId: id,
});

/* ------------------------------ PROMOTIONS -------------------------------- */

const listPromotionsSchema = listSchema({
  status: enumOf(COUPON_STATUS, 'status'),
  targetType: enumOf(PROMOTION_TARGET_TYPE, 'targetType'),
  activeNow: Joi.boolean(),
});

const savePromotionSchema = Joi.object({
  id,
  title: name(150).required(),
  description: longText,
  bannerUrl: url,
  targetType: enumOf(PROMOTION_TARGET_TYPE, 'targetType').default(PROMOTION_TARGET_TYPE.ALL),
  // Required unless targetType is ALL; enforced in the controller, which is the
  // only place that knows whether the target actually exists.
  targetId: id.allow(null),
  sortOrder: Joi.number().integer().min(0).max(9999).default(0),
  startsAt: futureDate.required(),
  endsAt: futureDate.greater(Joi.ref('startsAt')).required()
    .messages({ 'date.greater': 'endsAt must be after startsAt' }),
  status: enumOf(COUPON_STATUS, 'status').default(COUPON_STATUS.ACTIVE),
  isActive: Joi.boolean(),
});

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  listCouponsSchema,
  createCouponSchema,
  updateCouponSchema,
  availableCouponsSchema,
  listPromotionsSchema,
  savePromotionSchema,
  idSchema,
  emptySchema,
};
