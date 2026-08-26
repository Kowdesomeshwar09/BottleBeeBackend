'use strict';

const { User, Role, Permission } = require('../models');
const { ACCOUNT_STATUS, ROLES } = require('../config/constants');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken, extractBearerToken } = require('../utils/jwt');

/**
 * Resolves the caller from the bearer access token and attaches `req.user`.
 *
 * The token carries a roles/permissions snapshot so the common path needs no
 * database round trip, but the user row is still loaded to confirm the account
 * has not been suspended, blocked or deleted since the token was issued —
 * a revoked account must lose access immediately, not at token expiry.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) throw AppError.unauthorized('Authentication required');

  const decoded = verifyAccessToken(token);

  const user = await User.findByPk(decoded.sub, {
    include: [
      {
        model: Role,
        as: 'roles',
        through: { attributes: [] },
        required: false,
        include: [{ model: Permission, as: 'permissions', through: { attributes: [] }, required: false }],
      },
    ],
  });

  if (!user) throw AppError.unauthorized('Account no longer exists');

  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw AppError.forbidden('Your account is suspended. Please contact support.');
  }
  if (user.accountStatus === ACCOUNT_STATUS.BLOCKED || user.accountStatus === ACCOUNT_STATUS.DELETED) {
    throw AppError.forbidden('Your account is no longer active.');
  }
  if (!user.isActive) {
    throw AppError.forbidden('Your account is inactive. Please contact support.');
  }

  const roles = (user.roles || []).map((role) => role.code);
  const permissions = [
    ...new Set((user.roles || []).flatMap((role) => (role.permissions || []).map((p) => p.code))),
  ];

  req.user = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    accountStatus: user.accountStatus,
    roles,
    permissions,
    isSuperAdmin: roles.includes(ROLES.SUPER_ADMIN),
    record: user,
  };
  req.accessToken = token;

  return next();
});

/**
 * Attaches `req.user` when a valid token is present but never rejects.
 * Used by public catalog endpoints that personalise their response.
 */
const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  if (!extractBearerToken(req)) return next();
  try {
    return await authenticate(req, res, next);
  } catch (err) {
    return next();
  }
});

module.exports = { authenticate, optionalAuthenticate };
