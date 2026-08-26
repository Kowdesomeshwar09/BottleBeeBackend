'use strict';

const {
  Joi, requiredId, id, name, email, phone, money, percent, longText, url,
  postalCode, latitude, longitude, regionCode, shortText, enumOf, listSchema,
} = require('./common');
const { VENDOR_STATUS, VENDOR_ROLE, VERIFICATION_STATUS } = require('../config/constants');

const addressFields = {
  addressLine1: Joi.string().trim().min(3).max(255).required(),
  addressLine2: Joi.string().trim().max(255).allow('', null),
  city: name(100).required(),
  state: name(100).required(),
  postalCode: postalCode.required(),
  country: name(100).default('India'),
  regionCode: regionCode.allow('', null),
  latitude,
  longitude,
};

const applySchema = Joi.object({
  businessName: name(255).required(),
  legalName: name(255).required(),
  email: email.required(),
  phone: phone.required(),
  description: longText,
  deliveryRadiusKm: Joi.number().precision(2).min(0).max(200).allow(null),
  minOrderAmount: money.allow(null),
  // Commission is a platform term; ignored here unless staff set it later.
  commissionPercent: percent,
  address: Joi.object(addressFields),
});

const updateSchema = Joi.object({
  vendorId: id,
  businessName: name(255),
  legalName: name(255),
  email,
  phone,
  description: longText,
  logoUrl: url,
  deliveryRadiusKm: Joi.number().precision(2).min(0).max(200).allow(null),
  minOrderAmount: money.allow(null),
  commissionPercent: percent,
  isActive: Joi.boolean(),
}).min(1);

const listVendorsSchema = listSchema({
  status: enumOf(VENDOR_STATUS, 'status'),
  isActive: Joi.boolean(),
});

const reviewSchema = Joi.object({
  id: requiredId(),
  status: enumOf(VENDOR_STATUS, 'status').required(),
  reason: shortText(500),
  commissionPercent: percent,
});

const addLicenseSchema = Joi.object({
  vendorId: id,
  licenseNumber: Joi.string().trim().min(3).max(120).required(),
  licenseType: Joi.string().trim().min(2).max(100).required(),
  issuingAuthority: Joi.string().trim().min(2).max(255).required(),
  regionCode: regionCode.required(),
  validFrom: Joi.date().iso().required(),
  validUntil: Joi.date().iso().greater(Joi.ref('validFrom')).required()
    .messages({ 'date.greater': 'validUntil must be after validFrom' }),
});

const listLicensesSchema = listSchema({
  vendorId: id,
  status: enumOf(VERIFICATION_STATUS, 'status'),
  regionCode: regionCode,
  expiringSoon: Joi.boolean(),
});

const reviewLicenseSchema = Joi.object({
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

const saveAddressSchema = Joi.object({
  id,
  vendorId: id,
  ...addressFields,
  isPrimary: Joi.boolean().default(false),
});

const addStaffSchema = Joi.object({
  vendorId: id,
  email: email.required(),
  vendorRole: Joi.string()
    .trim()
    .uppercase()
    .valid(VENDOR_ROLE.MANAGER, VENDOR_ROLE.STAFF)
    .required(),
});

const vendorScopeSchema = Joi.object({ vendorId: id });
const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  applySchema,
  updateSchema,
  listVendorsSchema,
  reviewSchema,
  addLicenseSchema,
  listLicensesSchema,
  reviewLicenseSchema,
  saveAddressSchema,
  addStaffSchema,
  vendorScopeSchema,
  idSchema,
  emptySchema,
};
