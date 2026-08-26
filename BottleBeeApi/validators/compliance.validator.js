'use strict';

const {
  Joi, requiredId, name, money, regionCode, time, listSchema,
} = require('./common');

const listRulesSchema = listSchema({
  dryDay: Joi.boolean(),
});

const detailSchema = Joi.object({
  id: Joi.number().integer().positive(),
  regionCode: regionCode,
}).or('id', 'regionCode');

const upsertRuleSchema = Joi.object({
  regionCode: regionCode.required(),
  regionName: name(150).allow('', null),
  minimumAge: Joi.number().integer().min(18).max(30),
  alcoholSaleStartTime: time.allow(null),
  alcoholSaleEndTime: time.allow(null),
  dryDay: Joi.boolean(),
  maxOrderAmount: money.allow(null),
  maxQuantityPerOrder: Joi.number().integer().min(0).max(1000).allow(null),
  ruleMetadata: Joi.object({
    states: Joi.array().items(Joi.string().trim().max(100)),
    dryDates: Joi.array().items(Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/)),
    blockedTypes: Joi.array().items(Joi.string().trim().uppercase().max(40)),
    prohibition: Joi.boolean(),
    note: Joi.string().trim().max(500),
  }).allow(null),
  isActive: Joi.boolean(),
});

/** Public serviceability probe — takes a partial address, not an id. */
const serviceabilitySchema = Joi.object({
  regionCode: regionCode.allow('', null),
  state: name(100).allow('', null),
  city: name(100).allow('', null),
  postalCode: Joi.string().trim().max(20).allow('', null),
}).or('regionCode', 'state', 'postalCode');

const idSchema = Joi.object({ id: requiredId() });

module.exports = {
  listRulesSchema,
  detailSchema,
  upsertRuleSchema,
  serviceabilitySchema,
  idSchema,
};
