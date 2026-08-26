'use strict';

const { Op } = require('sequelize');

const { sequelize, Coupon, CouponUsage } = require('../models');
const { DISCOUNT_TYPE, COUPON_STATUS } = require('../config/constants');
const AppError = require('../utils/AppError');
const money = require('../utils/money');

/**
 * Coupon validation and redemption — SHARED SERVICE.
 *
 * Coupon administration lives in `coupon.controller.js`; promotional banners in
 * `promotion.controller.js`. What stays here is the part the cart and the order
 * controllers both depend on:
 *
 *   validateForCart  is this code usable, and what is it worth?
 *   redeem           consume it, within its usage limits
 *   releaseRedemption give it back when an order is cancelled
 *
 * The client only ever sends a code. The discount is always computed here from
 * the coupon row, so the cart preview and the amount actually charged cannot
 * disagree — and a client cannot name its own discount.
 */

/**
 * What a coupon is worth against a subtotal.
 *
 * A percentage coupon is capped by `maxDiscountAmount`, and no coupon may ever
 * exceed the subtotal: a discount can take an order to zero, never below, which
 * would otherwise mean paying the customer to order.
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
 * Validates a code for a specific cart and returns what it is worth.
 * Throws with a specific reason code so the cart can explain the rejection
 * rather than just saying "invalid".
 *
 * @param {object} params
 * @param {string} params.code
 * @param {number} params.userId
 * @param {number} params.subtotal
 * @param {number} [params.vendorId]     cart vendor, for store-scoped coupons
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
 *
 * The conditional UPDATE on `usage_count` is what makes a global usage limit
 * safe under load: if another checkout consumed the last redemption a
 * millisecond earlier, this update matches no rows and the order is rejected,
 * rather than both checkouts reading the same count and both succeeding.
 */
async function redeem({ coupon, userId, orderId, discountAmount, transaction, actorId = null }) {
  if (coupon.usageLimit !== null) {
    const [affected] = await Coupon.update(
      { usageCount: sequelize.literal('usage_count + 1'), updatedBy: actorId },
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

/**
 * Reverses redemption when an order is cancelled, so a customer is not charged a
 * use for an order that never happened. GREATEST guards the counter against
 * going negative if a reversal is ever applied twice.
 */
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

module.exports = { computeDiscount, validateForCart, redeem, releaseRedemption };
