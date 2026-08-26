'use strict';

const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');

/**
 * Auth controllers. Thin by design: read `req.body`, delegate to the service,
 * return through the centralized responder.
 */

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req);
  return created(res, result, 'Registration successful');
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req);
  return ok(res, result, 'Login successful');
});

const refreshToken = asyncHandler(async (req, res) => {
  const result = await authService.refreshSession(req.body, req);
  return ok(res, result, 'Session refreshed');
});

const logout = asyncHandler(async (req, res) => {
  const result = await authService.logout(req.body, req);
  return ok(res, result, 'Logged out successfully');
});

const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body, req);
  return ok(res, result, result.message);
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body, req);
  return ok(res, result, 'Password reset successfully. Please sign in.');
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword(req.body, req);
  return ok(res, result, result.message);
});

const me = asyncHandler(async (req, res) => {
  const result = await authService.me(req);
  return ok(res, result, 'Profile fetched successfully');
});

const sessions = asyncHandler(async (req, res) => {
  const result = await authService.listSessions(req);
  return ok(res, result, 'Active sessions fetched successfully');
});

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  me,
  sessions,
};
