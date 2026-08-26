'use strict';

const Joi = require('joi');

const config = require('../config');

/**
 * Reusable Joi fragments.
 *
 * Every validator composes from here so rules like "what counts as a strong
 * password" or "what an Indian phone number looks like" are defined once.
 */

const id = Joi.number().integer().positive();

const requiredId = (label = 'id') => id.required().label(label);

const email = Joi.string().trim().lowercase().email({ minDomainSegments: 2 }).max(255);

/** E.164, with or without the leading +. Indian numbers are the common case. */
const phone = Joi.string()
  .trim()
  .pattern(/^\+?[1-9]\d{7,14}$/)
  .message('Phone must be a valid international number, for example +919876543210');

/**
 * At least 8 characters with an upper case letter, a lower case letter, a digit
 * and a symbol. Rejected up front so a weak password never reaches bcrypt.
 */
const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[a-z]/, 'lowercase')
  .pattern(/[A-Z]/, 'uppercase')
  .pattern(/\d/, 'number')
  .pattern(/[^A-Za-z0-9]/, 'symbol')
  .messages({
    'string.pattern.name':
      'Password must be at least 8 characters and include upper case, lower case, a number and a symbol',
  });

const name = (max = 100) => Joi.string().trim().min(1).max(max);

const shortText = (max = 500) => Joi.string().trim().max(max).allow('', null);

const longText = Joi.string().trim().max(20000).allow('', null);

const url = Joi.string().trim().max(500).allow('', null);

const money = Joi.number().precision(2).min(0).max(99999999.99);

const percent = Joi.number().precision(2).min(0).max(100);

const quantity = Joi.number().integer().min(1).max(10000);

const latitude = Joi.number().min(-90).max(90).allow(null);
const longitude = Joi.number().min(-180).max(180).allow(null);

const dateOnly = Joi.date().iso().max('now');

const futureDate = Joi.date().iso();

const regionCode = Joi.string().trim().uppercase().max(50);

const postalCode = Joi.string().trim().max(20);

/** "HH:MM" or "HH:MM:SS". */
const time = Joi.string()
  .trim()
  .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .message('Time must be in HH:MM or HH:MM:SS format');

/**
 * Pagination, sorting and free-text search shared by every list endpoint.
 * List endpoints are POST by project convention, so these live in the body.
 */
const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(config.pagination.maxLimit).default(config.pagination.defaultLimit),
  sortBy: Joi.string().trim().max(60),
  sortOrder: Joi.string().trim().uppercase().valid('ASC', 'DESC').default('DESC'),
  search: Joi.string().trim().max(200).allow('', null),
};

/** A body carrying nothing but an id. */
const idOnly = Joi.object({ id: requiredId() });

/** A body carrying an id plus a soft-delete reason. */
const idWithReason = Joi.object({
  id: requiredId(),
  reason: shortText(500),
});

/** Enum helper that produces a readable error listing valid values. */
const enumOf = (obj, label) =>
  Joi.string()
    .trim()
    .uppercase()
    .valid(...Object.values(obj))
    .label(label || 'value');

/** Every list schema starts from these keys. */
const listSchema = (extra = {}) => Joi.object({ ...pagination, ...extra });

module.exports = {
  Joi,
  id,
  requiredId,
  email,
  phone,
  password,
  name,
  shortText,
  longText,
  url,
  money,
  percent,
  quantity,
  latitude,
  longitude,
  dateOnly,
  futureDate,
  regionCode,
  postalCode,
  time,
  pagination,
  idOnly,
  idWithReason,
  enumOf,
  listSchema,
};
