'use strict';

const {
  Joi, requiredId, email, phone, password, name, dateOnly, shortText, url, enumOf, listSchema,
} = require('./common');
const { ACCOUNT_STATUS, ROLES, GENDER } = require('../config/constants');

const roleCode = Joi.string().trim().uppercase().valid(...Object.values(ROLES));

const listUsersSchema = listSchema({
  accountStatus: enumOf(ACCOUNT_STATUS, 'accountStatus'),
  roleCode,
  isActive: Joi.boolean(),
});

const createUserSchema = Joi.object({
  firstName: name(100).required(),
  lastName: name(100).allow('', null),
  email: email.required(),
  phone: phone.required(),
  password: password.required(),
  // A customer record cannot exist without a date of birth: age eligibility
  // depends on it, so checkout would be un-evaluable without one.
  dateOfBirth: dateOnly.when('roleCodes', {
    is: Joi.array().has(Joi.string().valid(ROLES.CUSTOMER)),
    then: Joi.required(),
    otherwise: Joi.optional().allow(null),
  }),
  accountStatus: enumOf(ACCOUNT_STATUS, 'accountStatus').default(ACCOUNT_STATUS.ACTIVE),
  roleCodes: Joi.array().items(roleCode).min(1).unique().required(),
  legalFirstName: name(100).allow('', null),
  legalLastName: name(100).allow('', null),
  gender: enumOf(GENDER, 'gender').allow(null),
  preferredLanguage: Joi.string().trim().max(20).default('en'),
  timezone: Joi.string().trim().max(100).allow('', null),
});

const updateUserSchema = Joi.object({
  id: requiredId(),
  firstName: name(100),
  lastName: name(100).allow('', null),
  phone,
  profileImageUrl: url,
  dateOfBirth: dateOnly.allow(null),
  preferredLanguage: Joi.string().trim().max(20),
  timezone: Joi.string().trim().max(100).allow('', null),
  isActive: Joi.boolean(),
}).min(2);

const changeStatusSchema = Joi.object({
  id: requiredId(),
  accountStatus: enumOf(ACCOUNT_STATUS, 'accountStatus').required(),
  reason: shortText(500),
});

const deleteUserSchema = Joi.object({
  id: requiredId(),
  reason: shortText(500),
});

const resetUserPasswordSchema = Joi.object({
  id: requiredId(),
  password: password.required(),
});

const idSchema = Joi.object({ id: requiredId() });

module.exports = {
  listUsersSchema,
  createUserSchema,
  updateUserSchema,
  changeStatusSchema,
  deleteUserSchema,
  resetUserPasswordSchema,
  idSchema,
};
