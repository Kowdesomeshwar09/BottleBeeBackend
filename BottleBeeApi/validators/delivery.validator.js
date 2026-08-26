'use strict';

const {
  Joi, requiredId, id, shortText, latitude, longitude, enumOf, listSchema,
} = require('./common');
const {
  VEHICLE_TYPE, DELIVERY_PARTNER_STATUS, DELIVERY_ASSIGNMENT_STATUS, DOCUMENT_TYPE,
} = require('../config/constants');

const saveProfileSchema = Joi.object({
  vehicleType: enumOf(VEHICLE_TYPE, 'vehicleType').required(),
  vehicleNumber: Joi.string().trim().min(4).max(50).required(),
  licenseNumber: Joi.string().trim().min(4).max(100).required(),
});

const listPartnersSchema = listSchema({
  status: enumOf(DELIVERY_PARTNER_STATUS, 'status'),
  vehicleType: enumOf(VEHICLE_TYPE, 'vehicleType'),
});

const reviewPartnerSchema = Joi.object({
  id: requiredId(),
  status: enumOf(DELIVERY_PARTNER_STATUS, 'status').required(),
  reason: shortText(500),
});

const assignSchema = Joi.object({
  orderId: requiredId('orderId'),
  deliveryPartnerId: requiredId('deliveryPartnerId'),
});

const respondSchema = Joi.object({
  id: requiredId(),
  accept: Joi.boolean().required(),
  reason: shortText(500).when('accept', {
    is: false,
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
});

/**
 * Only the steps a partner drives themselves. ASSIGNED and DELIVERED are not
 * here: assignment is dispatch's decision, and completion has its own endpoint
 * because it must check the recipient was verified first.
 */
const advanceSchema = Joi.object({
  id: requiredId(),
  status: Joi.string()
    .trim()
    .uppercase()
    .valid(
      DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
      DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT,
      DELIVERY_ASSIGNMENT_STATUS.FAILED
    )
    .required(),
  note: shortText(500),
  reason: shortText(500).when('status', {
    is: DELIVERY_ASSIGNMENT_STATUS.FAILED,
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
});

/**
 * The legal handoff check. `documentType` is mandatory when verifying: recording
 * *what* was checked is the point — "verified" with no document named is not
 * evidence of anything.
 */
const verifyRecipientSchema = Joi.object({
  id: requiredId(),
  verified: Joi.boolean().required(),
  documentType: enumOf(DOCUMENT_TYPE, 'documentType').when('verified', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.optional().allow(null),
  }),
  notes: shortText(500).when('verified', {
    is: false,
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
});

const completeSchema = Joi.object({
  id: requiredId(),
  note: shortText(500),
});

const updateLocationSchema = Joi.object({
  latitude: latitude.required(),
  longitude: longitude.required(),
});

const listAssignmentsSchema = listSchema({
  status: enumOf(DELIVERY_ASSIGNMENT_STATUS, 'status'),
  orderId: id,
  deliveryPartnerId: id,
  activeOnly: Joi.boolean(),
});

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  saveProfileSchema,
  listPartnersSchema,
  reviewPartnerSchema,
  assignSchema,
  respondSchema,
  advanceSchema,
  verifyRecipientSchema,
  completeSchema,
  updateLocationSchema,
  listAssignmentsSchema,
  idSchema,
  emptySchema,
};
