'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const logger = require('../config/logger');
const {
  sequelize, User, Role, Permission, UserRole, CustomerProfile,
  RefreshToken, PasswordResetToken,
} = require('../models');
const { ROLES, ACCOUNT_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { hashPassword, comparePassword, generateOpaqueToken, sha256 } = require('../utils/crypto');
const { signAccessToken, signRefreshToken, verifyRefreshToken, expiresAtFrom } = require('../utils/jwt');
const { recordAudit, clientIp } = require('../utils/audit');
const { addMinutes } = require('../utils/dates');

/**
 * Authentication and session management.
 *
 * Sessions are a rotating refresh-token chain: each refresh mints a new token
 * and points the old one at its successor. Presenting a token that already has
 * a successor is treated as theft and revokes every session for that user.
 */

/** Account type a self-service registration may request. */
const REGISTRABLE_ROLES = {
  CUSTOMER: ROLES.CUSTOMER,
  VENDOR: ROLES.VENDOR_OWNER,
  DELIVERY_PARTNER: ROLES.DELIVERY_PARTNER,
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Loads roles + permissions for token claims and the /me payload. */
async function loadAuthorization(userId, transaction = null) {
  const user = await User.findByPk(userId, {
    include: [
      {
        model: Role,
        as: 'roles',
        through: { attributes: [] },
        required: false,
        include: [
          { model: Permission, as: 'permissions', through: { attributes: [] }, required: false },
        ],
      },
    ],
    transaction,
  });

  if (!user) throw AppError.notFound('User not found');

  const roles = (user.roles || []).map((r) => r.code);
  const permissions = [
    ...new Set((user.roles || []).flatMap((r) => (r.permissions || []).map((p) => p.code))),
  ];

  return { user, roles, permissions };
}

/**
 * Issues an access token plus a fresh refresh-token row.
 * Only the SHA-256 of the refresh token is stored.
 */
async function issueSession({ user, roles, permissions, req, transaction, replacesTokenId = null }) {
  const opaque = generateOpaqueToken();
  const tokenHash = sha256(opaque);

  const record = await RefreshToken.create(
    {
      userId: user.id,
      tokenHash,
      deviceId: req?.body?.deviceId || req?.headers?.['x-device-id'] || null,
      ipAddress: req ? clientIp(req) : null,
      userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 500) : null,
      expiresAt: expiresAtFrom(config.jwt.refreshExpiresIn),
      createdBy: user.id,
    },
    { transaction }
  );

  if (replacesTokenId) {
    await RefreshToken.update(
      { replacedByTokenId: record.id, revokedAt: new Date(), updatedBy: user.id },
      { where: { id: replacesTokenId }, transaction }
    );
  }

  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    roles,
    permissions,
  });

  // The signed refresh JWT wraps the opaque secret; the DB row is authoritative.
  const refreshToken = signRefreshToken({ userId: user.id, tokenId: `${record.id}.${opaque}` });

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: config.jwt.accessExpiresIn,
    refreshTokenExpiresAt: record.expiresAt,
  };
}

/** Public shape of a user, safe to return in any auth response. */
function publicUser(user, roles = [], permissions = []) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    profileImageUrl: user.profileImageUrl,
    accountStatus: user.accountStatus,
    emailVerified: !!user.emailVerifiedAt,
    phoneVerified: !!user.phoneVerifiedAt,
    preferredLanguage: user.preferredLanguage,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt,
    roles,
    permissions,
  };
}

/** Revokes every live refresh token for a user. Used on reset and on theft. */
async function revokeAllSessions(userId, { transaction = null, actorId = null } = {}) {
  return RefreshToken.update(
    { revokedAt: new Date(), updatedBy: actorId },
    { where: { userId, revokedAt: null }, transaction }
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Self-service registration.
 * `accountType` decides the role granted; a customer additionally gets a
 * customer_profiles row because date of birth is mandatory for age checks.
 */
async function register(payload, req) {
  const roleCode = REGISTRABLE_ROLES[payload.accountType];
  if (!roleCode) throw AppError.badRequest('Unsupported account type');

  const existing = await User.findOne({
    where: {
      [Op.or]: [
        { email: String(payload.email).toLowerCase() },
        ...(payload.phone ? [{ phone: payload.phone }] : []),
      ],
    },
    paranoid: false,
    attributes: ['id', 'email', 'phone'],
  });

  if (existing) {
    const field = existing.email === String(payload.email).toLowerCase() ? 'email' : 'phone';
    throw AppError.conflict('An account with these details already exists', [
      { field, message: `This ${field} is already registered` },
    ]);
  }

  const role = await Role.findOne({ where: { code: roleCode } });
  if (!role) throw AppError.internal(`Role ${roleCode} is not seeded. Run the database seeders.`);

  const result = await sequelize.transaction(async (transaction) => {
    const user = await User.create(
      {
        firstName: payload.firstName,
        lastName: payload.lastName || null,
        email: payload.email,
        phone: payload.phone || null,
        passwordHash: await hashPassword(payload.password),
        dateOfBirth: payload.dateOfBirth || null,
        // Registration is self-serve. The real gates are age verification
        // (customers), vendor approval and delivery-partner approval, so the
        // account itself starts ACTIVE with an unverified email.
        accountStatus: ACCOUNT_STATUS.ACTIVE,
        preferredLanguage: payload.preferredLanguage || 'en',
        timezone: payload.timezone || null,
      },
      { transaction }
    );

    await UserRole.create({ userId: user.id, roleId: role.id, createdBy: user.id }, { transaction });

    if (roleCode === ROLES.CUSTOMER) {
      await CustomerProfile.create(
        {
          userId: user.id,
          legalFirstName: payload.legalFirstName || payload.firstName,
          legalLastName: payload.legalLastName || payload.lastName || payload.firstName,
          dateOfBirth: payload.dateOfBirth,
          gender: payload.gender || null,
          marketingOptIn: payload.marketingOptIn ?? false,
          createdBy: user.id,
        },
        { transaction }
      );
    }

    const auth = await loadAuthorization(user.id, transaction);
    const session = await issueSession({ ...auth, req, transaction });

    return { auth, session };
  });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'User',
    entityId: result.auth.user.id,
    actorUserId: result.auth.user.id,
    newValues: { email: payload.email, accountType: payload.accountType, roles: result.auth.roles },
    req,
  });

  return {
    user: publicUser(result.auth.user, result.auth.roles, result.auth.permissions),
    tokens: result.session,
  };
}

/**
 * Password login with progressive lockout.
 * Failures are counted on the user row; after `maxLoginAttempts` the account is
 * locked for `accountLockMinutes`. Every outcome is audited.
 */
async function login(payload, req) {
  const email = String(payload.email).toLowerCase();

  const user = await User.scope('withPassword').findOne({ where: { email } });

  // Same message for unknown email and wrong password: no account enumeration.
  const invalidCredentials = AppError.unauthorized('Email or password is incorrect');

  if (!user) {
    await recordAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'User',
      newValues: { email, reason: 'UNKNOWN_EMAIL' },
      req,
    });
    throw invalidCredentials;
  }

  if (user.isLocked()) {
    await recordAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      newValues: { reason: 'ACCOUNT_LOCKED', lockedUntil: user.lockedUntil },
      req,
    });
    throw AppError.forbidden(
      'Too many failed attempts. This account is temporarily locked — try again later or reset your password.'
    );
  }

  const passwordMatches = await comparePassword(payload.password, user.passwordHash);

  if (!passwordMatches) {
    const attempts = user.loginAttempts + 1;
    const shouldLock = attempts >= config.security.maxLoginAttempts;

    await user.update({
      loginAttempts: shouldLock ? 0 : attempts,
      lockedUntil: shouldLock ? addMinutes(new Date(), config.security.accountLockMinutes) : null,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      newValues: { reason: 'BAD_PASSWORD', attempts, locked: shouldLock },
      req,
    });

    throw invalidCredentials;
  }

  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw AppError.forbidden('Your account is suspended. Please contact support.');
  }
  if (user.accountStatus === ACCOUNT_STATUS.BLOCKED || user.accountStatus === ACCOUNT_STATUS.DELETED) {
    throw AppError.forbidden('Your account is no longer active.');
  }
  if (!user.isActive) {
    throw AppError.forbidden('Your account is inactive. Please contact support.');
  }

  const session = await sequelize.transaction(async (transaction) => {
    await user.update({ loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }, { transaction });
    const auth = await loadAuthorization(user.id, transaction);
    const tokens = await issueSession({ ...auth, req, transaction });
    return { auth, tokens };
  });

  await recordAudit({
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    entityType: 'User',
    entityId: user.id,
    actorUserId: user.id,
    req,
  });

  return {
    user: publicUser(session.auth.user, session.auth.roles, session.auth.permissions),
    tokens: session.tokens,
  };
}

/**
 * Rotates a refresh token.
 * A token that has already been rotated (or revoked) is a replay: every session
 * for that user is revoked and the event is audited.
 */
async function refreshSession(payload, req) {
  const decoded = verifyRefreshToken(payload.refreshToken);

  const [recordId, opaque] = String(decoded.jti || '').split('.');
  if (!recordId || !opaque) throw AppError.unauthorized('Invalid refresh token');

  const record = await RefreshToken.findOne({
    where: { id: recordId, userId: decoded.sub, tokenHash: sha256(opaque) },
  });

  if (!record) throw AppError.unauthorized('Invalid refresh token');

  if (record.replacedByTokenId || record.revokedAt) {
    await revokeAllSessions(record.userId, { actorId: record.userId });
    await recordAudit({
      action: AUDIT_ACTIONS.TOKEN_REUSE_DETECTED,
      entityType: 'RefreshToken',
      entityId: record.id,
      actorUserId: record.userId,
      newValues: { reason: record.revokedAt ? 'REVOKED_TOKEN_PRESENTED' : 'ROTATED_TOKEN_PRESENTED' },
      req,
    });
    logger.warn('Refresh token replay detected for user %s', record.userId);
    throw AppError.unauthorized('This session is no longer valid. Please sign in again.');
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw AppError.unauthorized('Refresh token expired. Please sign in again.');
  }

  const result = await sequelize.transaction(async (transaction) => {
    const auth = await loadAuthorization(record.userId, transaction);

    if (!auth.user.isActive || auth.user.accountStatus === ACCOUNT_STATUS.BLOCKED
      || auth.user.accountStatus === ACCOUNT_STATUS.SUSPENDED
      || auth.user.accountStatus === ACCOUNT_STATUS.DELETED) {
      throw AppError.forbidden('Your account is no longer active.');
    }

    const tokens = await issueSession({ ...auth, req, transaction, replacesTokenId: record.id });
    return { auth, tokens };
  });

  await recordAudit({
    action: AUDIT_ACTIONS.TOKEN_REFRESH,
    entityType: 'RefreshToken',
    entityId: record.id,
    actorUserId: record.userId,
    req,
  });

  return {
    user: publicUser(result.auth.user, result.auth.roles, result.auth.permissions),
    tokens: result.tokens,
  };
}

/** Revokes the presented session, or every session when `allDevices` is true. */
async function logout(payload, req) {
  const userId = req.user.id;

  if (payload.allDevices) {
    await revokeAllSessions(userId, { actorId: userId });
  } else if (payload.refreshToken) {
    try {
      const decoded = verifyRefreshToken(payload.refreshToken);
      const [recordId, opaque] = String(decoded.jti || '').split('.');
      await RefreshToken.update(
        { revokedAt: new Date(), updatedBy: userId },
        { where: { id: recordId, userId, tokenHash: sha256(opaque), revokedAt: null } }
      );
    } catch (err) {
      // An unparseable token on logout is not worth failing the request over —
      // the caller's intent (end the session) is already satisfied.
      logger.debug('Logout presented an invalid refresh token: %s', err.message);
    }
  } else {
    await revokeAllSessions(userId, { actorId: userId });
  }

  await recordAudit({
    action: AUDIT_ACTIONS.LOGOUT,
    entityType: 'User',
    entityId: userId,
    actorUserId: userId,
    newValues: { allDevices: !!payload.allDevices },
    req,
  });

  return { loggedOut: true };
}

/**
 * Starts a password reset.
 *
 * Always reports success so the endpoint cannot be used to enumerate accounts.
 * There is no mail transport wired up yet, so outside production the one-time
 * token is returned in the response to keep the flow testable; in production it
 * is only logged and must be delivered by the notification worker.
 */
async function forgotPassword(payload, req) {
  const email = String(payload.email).toLowerCase();
  const user = await User.findOne({ where: { email } });

  const genericResponse = {
    requested: true,
    message: 'If an account exists for that email, a password reset link has been sent.',
  };

  if (!user) return genericResponse;

  const opaque = generateOpaqueToken(32);

  await sequelize.transaction(async (transaction) => {
    // Invalidate outstanding requests so only the newest link works.
    await PasswordResetToken.update(
      { usedAt: new Date(), updatedBy: user.id },
      { where: { userId: user.id, usedAt: null }, transaction }
    );

    await PasswordResetToken.create(
      {
        userId: user.id,
        tokenHash: sha256(opaque),
        expiresAt: addMinutes(new Date(), config.security.passwordResetExpiresMinutes),
        createdBy: user.id,
      },
      { transaction }
    );
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
    entityType: 'User',
    entityId: user.id,
    actorUserId: user.id,
    req,
  });

  logger.info('Password reset token issued for user %s', user.id);

  return config.isProduction
    ? genericResponse
    : { ...genericResponse, resetToken: opaque, expiresInMinutes: config.security.passwordResetExpiresMinutes };
}

/** Completes a password reset and drops every existing session. */
async function resetPassword(payload, req) {
  const record = await PasswordResetToken.findOne({
    where: { tokenHash: sha256(payload.token) },
  });

  if (!record || !record.isUsable()) {
    throw AppError.badRequest('This password reset link is invalid or has expired');
  }

  await sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(record.userId, { transaction });
    if (!user) throw AppError.notFound('User not found');

    await user.update(
      {
        passwordHash: await hashPassword(payload.password),
        loginAttempts: 0,
        lockedUntil: null,
        updatedBy: user.id,
      },
      { transaction }
    );

    await record.update({ usedAt: new Date(), updatedBy: user.id }, { transaction });

    // A password change must terminate every session, including any the
    // attacker may hold.
    await revokeAllSessions(user.id, { transaction, actorId: user.id });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
    entityType: 'User',
    entityId: record.userId,
    actorUserId: record.userId,
    req,
  });

  return { reset: true };
}

/** Changes the password for the signed-in user. */
async function changePassword(payload, req) {
  const user = await User.scope('withPassword').findByPk(req.user.id);
  if (!user) throw AppError.notFound('User not found');

  if (!(await comparePassword(payload.currentPassword, user.passwordHash))) {
    throw AppError.badRequest('Your current password is incorrect', [
      { field: 'currentPassword', message: 'Incorrect password' },
    ]);
  }

  await sequelize.transaction(async (transaction) => {
    await user.update(
      { passwordHash: await hashPassword(payload.newPassword), updatedBy: user.id },
      { transaction }
    );
    await revokeAllSessions(user.id, { transaction, actorId: user.id });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
    entityType: 'User',
    entityId: user.id,
    actorUserId: user.id,
    newValues: { method: 'SELF_SERVICE_CHANGE' },
    req,
  });

  return { changed: true, message: 'Password updated. Please sign in again.' };
}

/** Profile of the signed-in user, including role-specific context. */
async function me(req) {
  const { user, roles, permissions } = await loadAuthorization(req.user.id);

  const context = {};

  if (roles.includes(ROLES.CUSTOMER)) {
    const profile = await CustomerProfile.findOne({ where: { userId: user.id } });
    context.customerProfile = profile
      ? {
        id: profile.id,
        legalName: profile.legalName(),
        dateOfBirth: profile.dateOfBirth,
        gender: profile.gender,
        defaultAddressId: profile.defaultAddressId,
        ageVerified: profile.ageVerified,
        ageVerifiedAt: profile.ageVerifiedAt,
        marketingOptIn: profile.marketingOptIn,
      }
      : null;
  }

  if (roles.includes(ROLES.VENDOR_OWNER) || roles.includes(ROLES.VENDOR_MANAGER)) {
    const { Vendor, VendorUser } = require('../models');
    const memberships = await VendorUser.findAll({
      where: { userId: user.id },
      include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'status'] }],
    });
    context.vendors = memberships
      .filter((m) => m.vendor)
      .map((m) => ({
        vendorId: m.vendorId,
        businessName: m.vendor.businessName,
        status: m.vendor.status,
        vendorRole: m.vendorRole,
      }));
  }

  if (roles.includes(ROLES.DELIVERY_PARTNER)) {
    const { DeliveryPartner } = require('../models');
    const partner = await DeliveryPartner.findOne({ where: { userId: user.id } });
    context.deliveryPartner = partner
      ? {
        id: partner.id,
        status: partner.status,
        vehicleType: partner.vehicleType,
        vehicleNumber: partner.vehicleNumber,
        ratingAvg: partner.ratingAvg,
      }
      : null;
  }

  return { user: publicUser(user, roles, permissions), context };
}

/** Live sessions for the signed-in user, so they can spot an unknown device. */
async function listSessions(req) {
  const rows = await RefreshToken.findAll({
    where: { userId: req.user.id, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'deviceId', 'ipAddress', 'userAgent', 'createdAt', 'expiresAt'],
  });
  return rows;
}

module.exports = {
  register,
  login,
  refreshSession,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  me,
  listSessions,
  revokeAllSessions,
  loadAuthorization,
  publicUser,
  REGISTRABLE_ROLES,
};
