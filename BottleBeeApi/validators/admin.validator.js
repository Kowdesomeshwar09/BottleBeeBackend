'use strict';

const {
  Joi, id, listSchema,
} = require('./common');
const { AUDIT_ACTIONS } = require('../config/constants');

/** Reporting window. Defaults to the last 30 days when omitted. */
const windowSchema = Joi.object({
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso().min(Joi.ref('fromDate')),
});

const salesReportSchema = Joi.object({
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso().min(Joi.ref('fromDate')),
  vendorId: id,
});

const auditLogsSchema = listSchema({
  action: Joi.string().trim().uppercase().valid(...Object.values(AUDIT_ACTIONS)),
  entityType: Joi.string().trim().max(120),
  entityId: id,
  actorUserId: id,
  ipAddress: Joi.string().trim().max(80),
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso().min(Joi.ref('fromDate')),
});

const entityTrailSchema = Joi.object({
  entityType: Joi.string().trim().max(120).required(),
  entityId: id.required(),
});

module.exports = {
  windowSchema,
  salesReportSchema,
  auditLogsSchema,
  entityTrailSchema,
};
