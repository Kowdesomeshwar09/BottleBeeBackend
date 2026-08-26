'use strict';

const {
  Joi, requiredId, dateOnly, shortText, enumOf, listSchema,
} = require('./common');
const { DOCUMENT_TYPE, VERIFICATION_STATUS } = require('./../config/constants');

const submitSchema = Joi.object({
  documentType: enumOf(DOCUMENT_TYPE, 'documentType').required(),
  // Never persisted in the clear — hashed with a keyed HMAC before storage.
  documentNumber: Joi.string().trim().min(4).max(64).required(),
  dateOfBirth: dateOnly.required(),
});

const listSchemaBody = listSchema({
  status: enumOf(VERIFICATION_STATUS, 'status'),
  userId: Joi.number().integer().positive(),
});

const reviewSchema = Joi.object({
  id: requiredId(),
  status: Joi.string()
    .trim()
    .uppercase()
    .valid(VERIFICATION_STATUS.APPROVED, VERIFICATION_STATUS.REJECTED)
    .required(),
  rejectionReason: shortText(500).when('status', {
    is: VERIFICATION_STATUS.REJECTED,
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
});

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  submitSchema,
  listSchema: listSchemaBody,
  reviewSchema,
  idSchema,
  emptySchema,
};
