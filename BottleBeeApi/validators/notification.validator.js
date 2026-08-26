'use strict';

const {
  Joi, requiredId, shortText, url, enumOf, listSchema,
} = require('./common');
const { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS } = require('../config/constants');

const listNotificationsSchema = listSchema({
  status: enumOf(NOTIFICATION_STATUS, 'status'),
  channel: enumOf(NOTIFICATION_CHANNEL, 'channel'),
  unreadOnly: Joi.boolean().default(false),
});

const actionSchema = Joi.object({
  label: Joi.string().trim().max(100).required(),
  url: Joi.string().trim().max(500).required(),
});

const sendSystemSchema = Joi.object({
  userIds: Joi.array().items(Joi.number().integer().positive()).unique(),
  toAllUsers: Joi.boolean().default(false),
  templateCode: Joi.string().trim().uppercase().max(100).allow('', null),
  title: Joi.string().trim().max(255).allow('', null),
  message: Joi.string().trim().min(1).max(5000).required(),
  channel: enumOf(NOTIFICATION_CHANNEL, 'channel').default(NOTIFICATION_CHANNEL.IN_APP),
  variables: Joi.object().unknown(true),
  referenceType: Joi.string().trim().max(80).allow('', null),
  referenceId: Joi.number().integer().positive().allow(null),
  actions: Joi.array().items(actionSchema).max(5),
}).or('userIds', 'toAllUsers');

const listTemplatesSchema = listSchema({
  channel: enumOf(NOTIFICATION_CHANNEL, 'channel'),
});

const saveTemplateSchema = Joi.object({
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{3,100}$/).required()
    .messages({ 'string.pattern.base': 'Template code may contain only A-Z, 0-9 and underscore' }),
  channel: enumOf(NOTIFICATION_CHANNEL, 'channel').required(),
  subject: Joi.string().trim().max(255).allow('', null),
  // Placeholders use {{variableName}} and are substituted at send time.
  body: Joi.string().trim().min(1).max(20000).required(),
  variables: Joi.array().items(Joi.string().trim().max(60)).allow(null),
  isActive: Joi.boolean(),
});

const previewTemplateSchema = Joi.object({
  id: requiredId(),
  variables: Joi.object().unknown(true).default({}),
});

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  listNotificationsSchema,
  sendSystemSchema,
  listTemplatesSchema,
  saveTemplateSchema,
  previewTemplateSchema,
  idSchema,
  emptySchema,
};
