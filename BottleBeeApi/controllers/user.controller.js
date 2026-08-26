'use strict';

const userService = require('../services/user.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated, updated, deleted } = require('../utils/response');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await userService.list(req.body, req);
  return paginated(res, rows, meta, 'Users fetched successfully');
});

const detail = asyncHandler(async (req, res) => {
  const user = await userService.detail(req.body, req);
  return ok(res, user, 'User fetched successfully');
});

const create = asyncHandler(async (req, res) => {
  const user = await userService.create(req.body, req);
  return created(res, user, 'User created successfully');
});

const update = asyncHandler(async (req, res) => {
  const user = await userService.update(req.body, req);
  return updated(res, user, 'User updated successfully');
});

const changeStatus = asyncHandler(async (req, res) => {
  const user = await userService.changeStatus(req.body, req);
  return updated(res, user, 'Account status updated successfully');
});

const remove = asyncHandler(async (req, res) => {
  await userService.remove(req.body, req);
  return deleted(res, 'User deleted successfully');
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await userService.resetUserPassword(req.body, req);
  return ok(res, result, 'Password reset successfully');
});

const unlock = asyncHandler(async (req, res) => {
  const user = await userService.unlock(req.body, req);
  return updated(res, user, 'Account unlocked successfully');
});

module.exports = { list, detail, create, update, changeStatus, remove, resetPassword, unlock };
