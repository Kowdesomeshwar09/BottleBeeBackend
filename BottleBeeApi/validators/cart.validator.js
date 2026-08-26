'use strict';

const { Joi, requiredId, id, quantity } = require('./common');

/**
 * Cart inputs are deliberately minimal: a variant id, a quantity, a coupon code.
 * Prices, discounts and totals are never accepted from the client — the server
 * recomputes them from the catalog on every mutation.
 */

const addItemSchema = Joi.object({
  productVariantId: requiredId('productVariantId'),
  quantity: quantity.default(1),
});

const updateItemSchema = Joi.object({
  id: requiredId(),
  quantity: quantity.required(),
});

const applyCouponSchema = Joi.object({
  couponCode: Joi.string().trim().uppercase().min(3).max(80).required(),
});

/** Checkout readiness is evaluated against a specific delivery address. */
const validateForCheckoutSchema = Joi.object({
  deliveryAddressId: id,
});

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  addItemSchema,
  updateItemSchema,
  applyCouponSchema,
  validateForCheckoutSchema,
  idSchema,
  emptySchema,
};
