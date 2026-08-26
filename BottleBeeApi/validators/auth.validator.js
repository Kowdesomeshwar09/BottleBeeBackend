'use strict';

const {
  Joi, email, phone, password, name, dateOnly, enumOf,
} = require('./common');
const { GENDER } = require('../config/constants');

const ACCOUNT_TYPES = ['CUSTOMER', 'VENDOR', 'DELIVERY_PARTNER'];

/**
 * A customer must supply a date of birth at registration: age eligibility is
 * the first rule Bottle Bee enforces, and there is no customer record without
 * it. Vendors and delivery partners provide theirs during onboarding instead.
 */
const registerSchema = Joi.object({
  accountType: Joi.string().trim().uppercase().valid(...ACCOUNT_TYPES).default('CUSTOMER'),
  firstName: name(100).required(),
  lastName: name(100).allow('', null),
  email: email.required(),
  phone: phone.required(),
  password: password.required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).messages({
    'any.only': 'Passwords do not match',
  }),
  dateOfBirth: dateOnly.when('accountType', {
    is: 'CUSTOMER',
    then: Joi.required(),
    otherwise: Joi.optional().allow(null),
  }),
  legalFirstName: name(100).allow('', null),
  legalLastName: name(100).allow('', null),
  gender: enumOf(GENDER, 'gender').allow(null),
  marketingOptIn: Joi.boolean().default(false),
  preferredLanguage: Joi.string().trim().max(20).default('en'),
  timezone: Joi.string().trim().max(100).allow('', null),
  deviceId: Joi.string().trim().max(255).allow('', null),
});

const loginSchema = Joi.object({
  email: email.required(),
  password: Joi.string().max(128).required(),
  deviceId: Joi.string().trim().max(255).allow('', null),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const logoutSchema = Joi.object({
  refreshToken: Joi.string().allow('', null),
  allDevices: Joi.boolean().default(false),
});

const forgotPasswordSchema = Joi.object({
  email: email.required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().trim().max(255).required(),
  password: password.required(),
  confirmPassword: Joi.string().valid(Joi.ref('password')).messages({
    'any.only': 'Passwords do not match',
  }),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().max(128).required(),
  newPassword: password.required().invalid(Joi.ref('currentPassword')).messages({
    'any.invalid': 'New password must be different from the current password',
  }),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).messages({
    'any.only': 'Passwords do not match',
  }),
});

/** /me and /sessions take no input, but the convention is still a POST body. */
const emptySchema = Joi.object({});

module.exports = {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  emptySchema,
  ACCOUNT_TYPES,
};
