'use strict';

const {
  Joi, requiredId, id, shortText, enumOf, listSchema,
} = require('./common');
const { INVENTORY_TRANSACTION_TYPE, INVENTORY_REFERENCE_TYPE } = require('../config/constants');

/**
 * Only manual movement types are accepted from the API. RESERVE, RELEASE, SALE
 * and RETURN are written by the checkout, cancellation, delivery and refund
 * flows, never by a client — allowing them here would let a vendor desynchronise
 * reserved stock from live orders.
 */
const MANUAL_TRANSACTION_TYPES = [
  INVENTORY_TRANSACTION_TYPE.STOCK_IN,
  INVENTORY_TRANSACTION_TYPE.STOCK_OUT,
  INVENTORY_TRANSACTION_TYPE.ADJUSTMENT,
];

const listInventorySchema = listSchema({
  vendorId: id,
  productId: id,
  lowStockOnly: Joi.boolean(),
  outOfStockOnly: Joi.boolean(),
});

const adjustSchema = Joi.object({
  id: requiredId(),
  transactionType: Joi.string().trim().uppercase().valid(...MANUAL_TRANSACTION_TYPES).required(),
  // For STOCK_IN and STOCK_OUT this is a delta; for ADJUSTMENT it is the new
  // absolute count of units on the shelf.
  quantity: Joi.number().integer().min(0).max(1000000).required(),
  reorderLevel: Joi.number().integer().min(0).max(100000),
  notes: shortText(500),
});

const bulkAdjustSchema = Joi.object({
  transactionType: Joi.string().trim().uppercase().valid(...MANUAL_TRANSACTION_TYPES).required(),
  items: Joi.array()
    .items(Joi.object({
      id: requiredId(),
      quantity: Joi.number().integer().min(0).max(1000000).required(),
      reorderLevel: Joi.number().integer().min(0).max(100000),
    }))
    .min(1)
    .max(200)
    .required(),
  notes: shortText(500),
});

const transactionsSchema = listSchema({
  id: requiredId(),
  transactionType: enumOf(INVENTORY_TRANSACTION_TYPE, 'transactionType'),
  referenceType: enumOf(INVENTORY_REFERENCE_TYPE, 'referenceType'),
});

const vendorScopeSchema = listSchema({ vendorId: id });
const idSchema = Joi.object({ id: requiredId() });

module.exports = {
  listInventorySchema,
  adjustSchema,
  bulkAdjustSchema,
  transactionsSchema,
  vendorScopeSchema,
  idSchema,
  MANUAL_TRANSACTION_TYPES,
};
