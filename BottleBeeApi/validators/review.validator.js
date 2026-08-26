'use strict';

const {
  Joi, requiredId, id, shortText, longText, enumOf, listSchema,
} = require('./common');
const { REVIEW_STATUS } = require('../config/constants');

const rating = Joi.number().integer().min(1).max(5);

/**
 * Exactly one subject per review. A single row that rated the product, the store
 * and the rider at once could not be moderated or aggregated coherently, so the
 * schema, the model validator and a database CHECK all insist on one.
 */
const submitSchema = Joi.object({
  orderId: requiredId('orderId'),
  productId: id,
  vendorId: id,
  deliveryPartnerId: id,
  rating: rating.required(),
  title: shortText(150),
  comment: longText,
})
  .oxor('productId', 'vendorId', 'deliveryPartnerId')
  .or('productId', 'vendorId', 'deliveryPartnerId')
  .messages({
    'object.oxor': 'A review may target only one of product, store or delivery partner',
    'object.missing': 'Specify one of productId, vendorId or deliveryPartnerId',
  });

const publicListSchema = listSchema({
  productId: id,
  vendorId: id,
  deliveryPartnerId: id,
  rating,
})
  .or('productId', 'vendorId', 'deliveryPartnerId')
  .messages({ 'object.missing': 'Specify one of productId, vendorId or deliveryPartnerId' });

const myReviewsSchema = listSchema({
  status: enumOf(REVIEW_STATUS, 'status'),
});

const listSchemaBody = listSchema({
  status: enumOf(REVIEW_STATUS, 'status'),
  rating,
  productId: id,
  vendorId: id,
  deliveryPartnerId: id,
});

const moderateSchema = Joi.object({
  id: requiredId(),
  status: enumOf(REVIEW_STATUS, 'status').required(),
  // Rejecting or hiding without a note leaves nobody able to explain it later,
  // least of all to the customer whose review disappeared.
  moderationNote: shortText(500).when('status', {
    is: Joi.valid(REVIEW_STATUS.REJECTED, REVIEW_STATUS.HIDDEN),
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
});

const idSchema = Joi.object({ id: requiredId() });

module.exports = {
  submitSchema,
  publicListSchema,
  myReviewsSchema,
  listSchema: listSchemaBody,
  moderateSchema,
  idSchema,
};
