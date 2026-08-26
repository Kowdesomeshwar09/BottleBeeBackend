'use strict';

const rbacService = require('../services/rbac.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated, updated, deleted } = require('../utils/response');

const listRoles = asyncHandler(async (req, res) => {
  const { rows, meta } = await rbacService.listRoles(req.body, req);
  return paginated(res, rows, meta, 'Roles fetched successfully');
});

const getRole = asyncHandler(async (req, res) => {
  const role = await rbacService.getRole(req.body, req);
  return ok(res, role, 'Role fetched successfully');
});

const createRole = asyncHandler(async (req, res) => {
  const role = await rbacService.createRole(req.body, req);
  return created(res, role, 'Role created successfully');
});

const updateRole = asyncHandler(async (req, res) => {
  const role = await rbacService.updateRole(req.body, req);
  return updated(res, role, 'Role updated successfully');
});

const deleteRole = asyncHandler(async (req, res) => {
  await rbacService.deleteRole(req.body, req);
  return deleted(res, 'Role deleted successfully');
});

const listPermissions = asyncHandler(async (req, res) => {
  const { rows, meta } = await rbacService.listPermissions(req.body, req);
  return paginated(res, rows, meta, 'Permissions fetched successfully');
});

const permissionMatrix = asyncHandler(async (req, res) => {
  const matrix = await rbacService.permissionMatrix();
  return ok(res, matrix, 'Permission matrix fetched successfully');
});

const setRolePermissions = asyncHandler(async (req, res) => {
  const role = await rbacService.setRolePermissions(req.body, req);
  return updated(res, role, 'Role permissions updated successfully');
});

const assignRoles = asyncHandler(async (req, res) => {
  const result = await rbacService.assignRolesToUser(req.body, req);
  return updated(res, result, 'Roles assigned successfully');
});

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  permissionMatrix,
  setRolePermissions,
  assignRoles,
};
