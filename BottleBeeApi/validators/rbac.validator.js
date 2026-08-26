'use strict';

const {
  Joi, requiredId, name, shortText, listSchema,
} = require('./common');
const { ALL_PERMISSION_CODES, MODULES, ROLES } = require('../config/constants');

const permissionCode = Joi.string().trim().uppercase().valid(...ALL_PERMISSION_CODES);
const roleCode = Joi.string().trim().uppercase().valid(...Object.values(ROLES));

const listRolesSchema = listSchema({ isActive: Joi.boolean() });

const listPermissionsSchema = listSchema({
  module: Joi.string().trim().uppercase().valid(...Object.values(MODULES)),
});

const createRoleSchema = Joi.object({
  // New roles are free-form codes, not restricted to the seeded set.
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{3,80}$/).required()
    .messages({ 'string.pattern.base': 'Role code may contain only A-Z, 0-9 and underscore' }),
  name: name(120).required(),
  description: shortText(255),
  permissionCodes: Joi.array().items(permissionCode).unique().default([]),
});

const updateRoleSchema = Joi.object({
  id: requiredId(),
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9_]{3,80}$/),
  name: name(120),
  description: shortText(255),
  isActive: Joi.boolean(),
}).min(2);

const setRolePermissionsSchema = Joi.object({
  roleId: requiredId('roleId'),
  permissionCodes: Joi.array().items(permissionCode).unique().required(),
});

const assignRolesSchema = Joi.object({
  userId: requiredId('userId'),
  roleCodes: Joi.array().items(roleCode).min(1).unique().required(),
});

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  listRolesSchema,
  listPermissionsSchema,
  createRoleSchema,
  updateRoleSchema,
  setRolePermissionsSchema,
  assignRolesSchema,
  idSchema,
  emptySchema,
};
