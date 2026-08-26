'use strict';

const {
  Joi, requiredId, id, shortText, enumOf, listSchema,
} = require('./common');
const {
  ORDER_STATUS, ORDER_PAYMENT_STATUS, ORDER_DELIVERY_STATUS, PAYMENT_PROVIDER,
} = require('../config/constants');

/**
 * Checkout takes almost nothing from the client: a delivery address, a payment
 * method and an optional note. Items, prices, discounts and totals all come from
 * the server's own view of the cart and catalog.
 */
const checkoutSchema = Joi.object({
  deliveryAddressId: id,
  paymentMethod: enumOf(PAYMENT_PROVIDER, 'paymentMethod').default(PAYMENT_PROVIDER.RAZORPAY),
  customerNotes: shortText(500),
});

const listOrdersSchema = listSchema({
  status: Joi.alternatives().try(
    enumOf(ORDER_STATUS, 'status'),
    Joi.array().items(enumOf(ORDER_STATUS, 'status')).max(12)
  ),
  paymentStatus: enumOf(ORDER_PAYMENT_STATUS, 'paymentStatus'),
  deliveryStatus: enumOf(ORDER_DELIVERY_STATUS, 'deliveryStatus'),
  orderNumber: Joi.string().trim().max(50),
  vendorId: id,
  customerId: id,
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso().min(Joi.ref('fromDate')),
});

const trackSchema = Joi.object({
  id,
  orderNumber: Joi.string().trim().max(50),
}).or('id', 'orderNumber');

const updateStatusSchema = Joi.object({
  id: requiredId(),
  status: enumOf(ORDER_STATUS, 'status').required(),
  // Cancellation without a reason leaves nobody able to explain it later.
  reason: shortText(500).when('status', {
    is: ORDER_STATUS.CANCELLED,
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
  note: shortText(500),
});

const cancelSchema = Joi.object({
  id: requiredId(),
  reason: Joi.string().trim().min(3).max(500).required(),
});

const historySchema = listSchema({ id: requiredId() });

const summarySchema = Joi.object({
  vendorId: id,
  customerId: id,
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso().min(Joi.ref('fromDate')),
});

const idSchema = Joi.object({ id: requiredId() });

module.exports = {
  checkoutSchema,
  listOrdersSchema,
  trackSchema,
  updateStatusSchema,
  cancelSchema,
  historySchema,
  summarySchema,
  idSchema,
};
