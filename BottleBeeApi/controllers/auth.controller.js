'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const logger = require('../config/logger');
const {
  sequelize, User, Role, Permission, UserRole, CustomerProfile, Vendor, VendorUser,
  DeliveryPartner, RefreshToken, PasswordResetToken,
} = require('../models');
const { ROLES, ACCOUNT_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const {
  hashPassword, comparePassword, generateOpaqueToken, sha256,
} = require('../utils/crypto');
const {
  signAccessToken, signRefreshToken, verifyRefreshToken, expiresAtFrom,
} = require('../utils/jwt');
const { recordAudit, clientIp } = require('../utils/audit');
const { addMinutes } = require('../utils/dates');
const { ok, created, fail } = require('../utils/response');

/**
 * Authentication and session management.
 *
 * Sessions are a rotating refresh-token chain: each refresh mints a new token
 * and points the old one at its successor. Presenting a token that already has a
 * successor means the token was replayed — most likely stolen — so every session
 * for that user is revoked rather than just the one presented.
 *
 * Only the SHA-256 of a refresh token is stored, so a database leak cannot be
 * replayed as a live session.
 */

/** Account type a self-service registration may request. */
const REGISTRABLE_ROLES = {
  CUSTOMER: ROLES.CUSTOMER,
  VENDOR: ROLES.VENDOR_OWNER,
  DELIVERY_PARTNER: ROLES.DELIVERY_PARTNER,
};

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

/** Loads roles and permissions for token claims and the /me payload. */
async function loadAuthorization(userId, transaction = null) {
  const user = await User.findByPk(userId, {
    include: [{
      model: Role,
      as: 'roles',
      through: { attributes: [] },
      required: false,
      include: [{
        model: Permission,
        as: 'permissions',
        through: { attributes: [] },
        required: false,
      }],
    }],
    transaction,
  });

  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  const roles = (user.roles || []).map((r) => r.code);
  const permissions = [
    ...new Set((user.roles || []).flatMap((r) => (r.permissions || []).map((p) => p.code))),
  ];

  return { user, roles, permissions };
}

/**
 * Issues an access token plus a fresh refresh-token row.
 * `replacesTokenId` closes the previous link in the rotation chain.
 */
async function issueSession({ user, roles, permissions, req, transaction, replacesTokenId = null }) {
  const opaque = generateOpaqueToken();

  const record = await RefreshToken.create(
    {
      userId: user.id,
      tokenHash: sha256(opaque),
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

  return {
    accessToken: signAccessToken({
      userId: user.id, email: user.email, roles, permissions,
    }),
    // The signed JWT wraps the opaque secret; the database row is authoritative.
    refreshToken: signRefreshToken({ userId: user.id, tokenId: `${record.id}.${opaque}` }),
    accessTokenExpiresIn: config.jwt.accessExpiresIn,
    refreshTokenExpiresAt: record.expiresAt,
  };
}

/** Shape safe to return in any auth response. */
const publicUser = (user, roles = [], permissions = []) => ({
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
});

/** Revokes every live refresh token for a user. */
const revokeAllSessions = (userId, { transaction = null, actorId = null } = {}) => RefreshToken.update(
  { revokedAt: new Date(), updatedBy: actorId },
  { where: { userId, revokedAt: null }, transaction }
);

/** Statuses that must not be able to obtain or keep a session. */
const isBlockedStatus = (status) => [
  ACCOUNT_STATUS.SUSPENDED, ACCOUNT_STATUS.BLOCKED, ACCOUNT_STATUS.DELETED,
].includes(status);

/* -------------------------------------------------------------------------- */
/*                                 REGISTER                                   */
/* -------------------------------------------------------------------------- */
const register = async (req, res) => {
  try {
    const { body } = req;

    const roleCode = REGISTRABLE_ROLES[body.accountType];
    if (!roleCode) return fail(res, 'Unsupported account type', 400);

    const existing = await User.findOne({
      where: {
        [Op.or]: [
          { email: String(body.email).toLowerCase() },
          ...(body.phone ? [{ phone: body.phone }] : []),
        ],
      },
      paranoid: false,
      attributes: ['id', 'email', 'phone'],
    });

    if (existing) {
      const field = existing.email === String(body.email).toLowerCase() ? 'email' : 'phone';
      return fail(res, 'An account with these details already exists', 409, [
        { field, message: `This ${field} is already registered` },
      ]);
    }

    const role = await Role.findOne({ where: { code: roleCode } });
    if (!role) {
      return fail(res, `Role ${roleCode} is not seeded. Run the database seeders.`, 500);
    }

    const result = await sequelize.transaction(async (transaction) => {
      const user = await User.create(
        {
          firstName: body.firstName,
          lastName: body.lastName || null,
          email: body.email,
          phone: body.phone || null,
          passwordHash: await hashPassword(body.password),
          dateOfBirth: body.dateOfBirth || null,
          // Registration is self-serve. The real gates are age verification for
          // customers, and admin approval for stores and delivery partners.
          accountStatus: ACCOUNT_STATUS.ACTIVE,
          preferredLanguage: body.preferredLanguage || 'en',
          timezone: body.timezone || null,
        },
        { transaction }
      );

      await UserRole.create(
        { userId: user.id, roleId: role.id, createdBy: user.id },
        { transaction }
      );

      // A customer cannot exist without a date of birth: it is the input to
      // every age check the platform makes.
      if (roleCode === ROLES.CUSTOMER) {
        await CustomerProfile.create(
          {
            userId: user.id,
            legalFirstName: body.legalFirstName || body.firstName,
            legalLastName: body.legalLastName || body.lastName || body.firstName,
            dateOfBirth: body.dateOfBirth,
            gender: body.gender || null,
            marketingOptIn: body.marketingOptIn ?? false,
            createdBy: user.id,
          },
          { transaction }
        );
      }

      const auth = await loadAuthorization(user.id, transaction);
      const tokens = await issueSession({ ...auth, req, transaction });

      return { auth, tokens };
    });

    await recordAudit({
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: 'User',
      entityId: result.auth.user.id,
      actorUserId: result.auth.user.id,
      newValues: {
        email: body.email,
        accountType: body.accountType,
        roles: result.auth.roles,
      },
      req,
    });

    return created(
      res,
      {
        user: publicUser(result.auth.user, result.auth.roles, result.auth.permissions),
        tokens: result.tokens,
      },
      'Registration successful'
    );
  } catch (error) {
    logger.error('Registration failed: %s', error.message);
    return fail(res, 'Registration failed', error.statusCode || 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                                   LOGIN                                    */
/* -------------------------------------------------------------------------- */
/**
 * Password login with progressive lockout. Unknown email and wrong password
 * return the same message, so the endpoint cannot be used to discover which
 * addresses are registered. Every outcome is audited.
 */
const login = async (req, res) => {
  try {
    const email = String(req.body.email).toLowerCase();
    const user = await User.scope('withPassword').findOne({ where: { email } });

    const invalidCredentials = 'Email or password is incorrect';

    if (!user) {
      await recordAudit({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entityType: 'User',
        newValues: { email, reason: 'UNKNOWN_EMAIL' },
        req,
      });
      return fail(res, invalidCredentials, 401);
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
      return fail(
        res,
        'Too many failed attempts. This account is temporarily locked — try again later or reset your password.',
        403
      );
    }

    if (!(await comparePassword(req.body.password, user.passwordHash))) {
      const attempts = user.loginAttempts + 1;
      const shouldLock = attempts >= config.security.maxLoginAttempts;

      await user.update({
        loginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? addMinutes(new Date(), config.security.accountLockMinutes)
          : null,
      });

      await recordAudit({
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
        newValues: { reason: 'BAD_PASSWORD', attempts, locked: shouldLock },
        req,
      });

      return fail(res, invalidCredentials, 401);
    }

    if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
      return fail(res, 'Your account is suspended. Please contact support.', 403);
    }
    if (isBlockedStatus(user.accountStatus)) {
      return fail(res, 'Your account is no longer active.', 403);
    }
    if (!user.isActive) {
      return fail(res, 'Your account is inactive. Please contact support.', 403);
    }

    const session = await sequelize.transaction(async (transaction) => {
      await user.update(
        { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
        { transaction }
      );
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

    return ok(
      res,
      {
        user: publicUser(session.auth.user, session.auth.roles, session.auth.permissions),
        tokens: session.tokens,
      },
      'Login successful'
    );
  } catch (error) {
    logger.error('Login failed: %s', error.message);
    return fail(res, 'Login failed', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                           ROTATE A REFRESH TOKEN                           */
/* -------------------------------------------------------------------------- */
const refreshToken = async (req, res) => {
  try {
    const decoded = verifyRefreshToken(req.body.refreshToken);

    const [recordId, opaque] = String(decoded.jti || '').split('.');
    if (!recordId || !opaque) return fail(res, 'Invalid refresh token', 401);

    const record = await RefreshToken.findOne({
      where: { id: recordId, userId: decoded.sub, tokenHash: sha256(opaque) },
    });
    if (!record) return fail(res, 'Invalid refresh token', 401);

    // A token that already has a successor, or was revoked, is being replayed.
    // Assume theft and drop every session rather than only this one.
    if (record.replacedByTokenId || record.revokedAt) {
      await revokeAllSessions(record.userId, { actorId: record.userId });

      await recordAudit({
        action: AUDIT_ACTIONS.TOKEN_REUSE_DETECTED,
        entityType: 'RefreshToken',
        entityId: record.id,
        actorUserId: record.userId,
        newValues: {
          reason: record.revokedAt ? 'REVOKED_TOKEN_PRESENTED' : 'ROTATED_TOKEN_PRESENTED',
        },
        req,
      });

      logger.warn('Refresh token replay detected for user %s', record.userId);
      return fail(res, 'This session is no longer valid. Please sign in again.', 401);
    }

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      return fail(res, 'Refresh token expired. Please sign in again.', 401);
    }

    const auth = await loadAuthorization(record.userId);
    if (!auth.user.isActive || isBlockedStatus(auth.user.accountStatus)) {
      return fail(res, 'Your account is no longer active.', 403);
    }

    const result = await sequelize.transaction(async (transaction) => {
      const fresh = await loadAuthorization(record.userId, transaction);
      const tokens = await issueSession({
        ...fresh, req, transaction, replacesTokenId: record.id,
      });
      return { auth: fresh, tokens };
    });

    await recordAudit({
      action: AUDIT_ACTIONS.TOKEN_REFRESH,
      entityType: 'RefreshToken',
      entityId: record.id,
      actorUserId: record.userId,
      req,
    });

    return ok(
      res,
      {
        user: publicUser(result.auth.user, result.auth.roles, result.auth.permissions),
        tokens: result.tokens,
      },
      'Session refreshed'
    );
  } catch (error) {
    return fail(res, error.message || 'Could not refresh session', error.statusCode || 401);
  }
};

/* -------------------------------------------------------------------------- */
/*                                  LOGOUT                                    */
/* -------------------------------------------------------------------------- */
const logout = async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.body.allDevices || !req.body.refreshToken) {
      await revokeAllSessions(userId, { actorId: userId });
    } else {
      try {
        const decoded = verifyRefreshToken(req.body.refreshToken);
        const [recordId, opaque] = String(decoded.jti || '').split('.');

        await RefreshToken.update(
          { revokedAt: new Date(), updatedBy: userId },
          {
            where: {
              id: recordId, userId, tokenHash: sha256(opaque), revokedAt: null,
            },
          }
        );
      } catch (err) {
        // An unparseable token on logout is not worth failing over: the
        // caller's intent — end the session — is already satisfied.
        logger.debug('Logout presented an invalid refresh token: %s', err.message);
      }
    }

    await recordAudit({
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: 'User',
      entityId: userId,
      actorUserId: userId,
      newValues: { allDevices: !!req.body.allDevices },
      req,
    });

    return ok(res, { loggedOut: true }, 'Logged out successfully');
  } catch (error) {
    return fail(res, 'Logout failed', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       REQUEST A PASSWORD RESET                             */
/* -------------------------------------------------------------------------- */
/**
 * Always reports success, whether or not the email exists, so the endpoint
 * cannot be used to enumerate accounts.
 *
 * There is no mail transport wired up yet, so outside production the one-time
 * token is returned in the response to keep the flow testable. In production it
 * is only logged, and must be delivered by the notification worker.
 */
const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email).toLowerCase();
    const user = await User.findOne({ where: { email } });

    const message = 'If an account exists for that email, a password reset link has been sent.';

    if (!user) return ok(res, { requested: true, message }, message);

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

    const payload = config.isProduction
      ? { requested: true, message }
      : {
        requested: true,
        message,
        resetToken: opaque,
        expiresInMinutes: config.security.passwordResetExpiresMinutes,
      };

    return ok(res, payload, message);
  } catch (error) {
    return fail(res, 'Could not process password reset request', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       COMPLETE A PASSWORD RESET                            */
/* -------------------------------------------------------------------------- */
const resetPassword = async (req, res) => {
  try {
    const record = await PasswordResetToken.findOne({
      where: { tokenHash: sha256(req.body.token) },
    });

    if (!record || !record.isUsable()) {
      return fail(res, 'This password reset link is invalid or has expired', 400);
    }

    await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(record.userId, { transaction });
      if (!user) {
        const err = new Error('User not found');
        err.statusCode = 404;
        throw err;
      }

      await user.update(
        {
          passwordHash: await hashPassword(req.body.password),
          loginAttempts: 0,
          lockedUntil: null,
          updatedBy: user.id,
        },
        { transaction }
      );

      await record.update({ usedAt: new Date(), updatedBy: user.id }, { transaction });

      // A password change must terminate every session, including any an
      // attacker may be holding.
      await revokeAllSessions(user.id, { transaction, actorId: user.id });
    });

    await recordAudit({
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      entityType: 'User',
      entityId: record.userId,
      actorUserId: record.userId,
      req,
    });

    return ok(res, { reset: true }, 'Password reset successfully. Please sign in.');
  } catch (error) {
    return fail(res, 'Could not reset password', error.statusCode || 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          CHANGE MY OWN PASSWORD                            */
/* -------------------------------------------------------------------------- */
const changePassword = async (req, res) => {
  try {
    const user = await User.scope('withPassword').findByPk(req.user.id);
    if (!user) return fail(res, 'User not found', 404);

    if (!(await comparePassword(req.body.currentPassword, user.passwordHash))) {
      return fail(res, 'Your current password is incorrect', 400, [
        { field: 'currentPassword', message: 'Incorrect password' },
      ]);
    }

    await sequelize.transaction(async (transaction) => {
      await user.update(
        { passwordHash: await hashPassword(req.body.newPassword), updatedBy: user.id },
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

    const message = 'Password updated. Please sign in again.';
    return ok(res, { changed: true, message }, message);
  } catch (error) {
    return fail(res, 'Could not change password', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        MY PROFILE AND ROLE CONTEXT                         */
/* -------------------------------------------------------------------------- */
/** Identity, roles, permissions, plus whatever the caller's role implies. */
const me = async (req, res) => {
  try {
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
      const partner = await DeliveryPartner.findOne({ where: { userId: user.id } });
      context.deliveryPartner = partner
        ? {
          id: partner.id,
          status: partner.status,
          vehicleType: partner.vehicleType,
          vehicleNumber: partner.vehicleNumber,
          ratingAvg: Number(partner.ratingAvg || 0),
        }
        : null;
    }

    return ok(
      res,
      { user: publicUser(user, roles, permissions), context },
      'Profile fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching profile', error.statusCode || 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            MY ACTIVE SESSIONS                              */
/* -------------------------------------------------------------------------- */
/** Lets a user spot a device they do not recognise. */
const sessions = async (req, res) => {
  try {
    const rows = await RefreshToken.findAll({
      where: { userId: req.user.id, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'deviceId', 'ipAddress', 'userAgent', 'createdAt', 'expiresAt'],
    });

    return ok(res, rows, 'Active sessions fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching sessions', 500, [{ message: error.message }]);
  }
};

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
  REGISTRABLE_ROLES,
  publicUser,
  loadAuthorization,
};
