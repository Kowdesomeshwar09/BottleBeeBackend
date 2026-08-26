'use strict';

const {
  Joi, requiredId, id, money, shortText, enumOf, listSchema,
} = require('./common');
const { PAYMENT_STATUS, REFUND_STATUS } = require('../config/constants');

/**
 * The amount is never accepted on the way in. A payment intent is always raised
 * for the order's own `grandTotal`, so a tampered amount has nowhere to enter.
 */
const createIntentSchema = Joi.object({
  orderId: requiredId('orderId'),
});

const confirmSchema = Joi.object({
  providerOrderId: Joi.string().trim().max(255).required(),
  providerPaymentId: Joi.string().trim().max(255).required(),
  // HMAC over `providerOrderId|providerPaymentId`. Without it, knowing an order
  // id would be enough to mark it paid.
  signature: Joi.string().trim().max(512).required(),
});

const markFailedSchema = Joi.object({
  providerOrderId: Joi.string().trim().max(255).required(),
  providerPaymentId: Joi.string().trim().max(255).allow('', null),
  reason: shortText(500),
});

const listPaymentsSchema = listSchema({
  orderId: id,
  status: enumOf(PAYMENT_STATUS, 'status'),
  vendorId: id,
  customerId: id,
});

const requestRefundSchema = Joi.object({
  orderId: requiredId('orderId'),
  // Omit for a full refund of what remains refundable.
  amount: money.greater(0),
  reason: Joi.string().trim().min(3).max(500).required(),
});

const reviewRefundSchema = Joi.object({
  id: requiredId(),
  status: Joi.string()
    .trim()
    .uppercase()
    .valid(REFUND_STATUS.APPROVED, REFUND_STATUS.REJECTED)
    .required(),
  rejectionReason: shortText(500).when('status', {
    is: REFUND_STATUS.REJECTED,
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
});

const listRefundsSchema = listSchema({
  orderId: id,
  status: enumOf(REFUND_STATUS, 'status'),
  vendorId: id,
  customerId: id,
});

const idSchema = Joi.object({ id: requiredId() });

module.exports = {
  createIntentSchema,
  confirmSchema,
  markFailedSchema,
  listPaymentsSchema,
  requestRefundSchema,
  reviewRefundSchema,
  listRefundsSchema,
  idSchema,
};
