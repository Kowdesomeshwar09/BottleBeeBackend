'use strict';

const {
  Joi, requiredId, name, phone, dateOnly, shortText, postalCode, latitude, longitude,
  regionCode, enumOf, listSchema,
} = require('./common');
const { GENDER } = require('../config/constants');

const saveProfileSchema = Joi.object({
  legalFirstName: name(100).required(),
  legalLastName: name(100).required(),
  dateOfBirth: dateOnly.required(),
  gender: enumOf(GENDER, 'gender').allow(null),
  marketingOptIn: Joi.boolean(),
});

const addressBody = {
  label: Joi.string().trim().max(80).allow('', null),
  recipientName: name(150),
  phone,
  addressLine1: Joi.string().trim().min(3).max(255),
  addressLine2: Joi.string().trim().max(255).allow('', null),
  city: name(100),
  state: name(100),
  postalCode,
  country: name(100).default('India'),
  regionCode: regionCode.allow('', null),
  latitude,
  longitude,
  isDefault: Joi.boolean().default(false),
  deliveryInstructions: shortText(500),
};

const createAddressSchema = Joi.object({
  ...addressBody,
  recipientName: addressBody.recipientName.required(),
  phone: phone.required(),
  addressLine1: addressBody.addressLine1.required(),
  city: addressBody.city.required(),
  state: addressBody.state.required(),
  postalCode: postalCode.required(),
});

const updateAddressSchema = Joi.object({
  id: requiredId(),
  ...addressBody,
  // `isDefault` has a default on create; on update it must stay optional so a
  // partial edit does not silently demote the current default address.
  isDefault: Joi.boolean(),
  country: name(100),
}).min(2);

const listAddressesSchema = listSchema();

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

const adminListCustomersSchema = listSchema({
  ageVerified: Joi.boolean(),
});

module.exports = {
  saveProfileSchema,
  createAddressSchema,
  updateAddressSchema,
  listAddressesSchema,
  adminListCustomersSchema,
  idSchema,
  emptySchema,
};
