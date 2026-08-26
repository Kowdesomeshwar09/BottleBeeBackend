'use strict';

const { Op } = require('sequelize');

const {
  sequelize, User, Role, UserRole, CustomerProfile, RefreshToken,
} = require('../models');
const { ROLES, ACCOUNT_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { hashPassword } = require('../utils/crypto');
const { recordAudit } = require('../utils/audit');

/** User administration. Self-service profile edits live in customer.service. */

const SORTABLE = ['id', 'firstName', 'lastName', 'email', 'accountStatus', 'lastLoginAt', 'createdAt'];

function serialize(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    profileImageUrl: user.profileImageUrl,
    dateOfBirth: user.dateOfBirth,
    accountStatus: user.accountStatus,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    isLocked: typeof user.isLocked === 'function' ? user.isLocked() : undefined,
    lockedUntil: user.lockedUntil,
    preferredLanguage: user.preferredLanguage,
    timezone: user.timezone,
    isActive: user.isActive,
    roles: (user.roles || []).map((r) => ({ id: r.id, code: r.code, name: r.name })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function list(body) {
  const { page, limit, offset, order } = buildPagination(body, { sortable: SORTABLE });

  const where = {};
  if (body.accountStatus) where.accountStatus = body.accountStatus;
  if (body.isActive !== undefined && body.isActive !== null) where.isActive = body.isActive;
  if (body.search) {
    where[Op.or] = [
      { firstName: { [Op.like]: `%${body.search}%` } },
      { lastName: { [Op.like]: `%${body.search}%` } },
      { email: { [Op.like]: `%${body.search}%` } },
      { phone: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const include = [
    {
      model: Role,
      as: 'roles',
      through: { attributes: [] },
      required: !!body.roleCode,
      ...(body.roleCode ? { where: { code: body.roleCode } } : {}),
    },
  ];

  const result = await User.findAndCountAll({
    where, include, limit, offset, order, distinct: true,
  });

  return { rows: result.rows.map(serialize), meta: toPageMeta(result, { page, limit }) };
}

async function detail(body) {
  const user = await User.findByPk(body.id, {
    include: [
      { model: Role, as: 'roles', through: { attributes: [] }, required: false },
      { model: CustomerProfile, as: 'customerProfile', required: false },
    ],
  });
  if (!user) throw AppError.notFound('User not found');

  return {
    ...serialize(user),
    customerProfile: user.customerProfile
      ? {
        id: user.customerProfile.id,
        legalFirstName: user.customerProfile.legalFirstName,
        legalLastName: user.customerProfile.legalLastName,
        dateOfBirth: user.customerProfile.dateOfBirth,
        ageVerified: user.customerProfile.ageVerified,
        ageVerifiedAt: user.customerProfile.ageVerifiedAt,
      }
      : null,
  };
}

/**
 * Admin-created user. Roles are validated the same way as in rbac.service so
 * an ADMIN cannot mint a SUPER_ADMIN.
 */
async function create(body, req) {
  const existing = await User.findOne({
    where: {
      [Op.or]: [
        { email: String(body.email).toLowerCase() },
        ...(body.phone ? [{ phone: body.phone }] : []),
      ],
    },
    paranoid: false,
    attributes: ['id', 'email'],
  });
  if (existing) throw AppError.conflict('A user with this email or phone already exists');

  if (body.roleCodes.includes(ROLES.SUPER_ADMIN) && !req.user.isSuperAdmin) {
    throw AppError.forbidden('Only a super administrator may create another super administrator');
  }

  const roles = await Role.findAll({ where: { code: { [Op.in]: body.roleCodes } } });
  const unknown = body.roleCodes.filter((code) => !roles.some((r) => r.code === code));
  if (unknown.length) throw AppError.badRequest('Unknown role codes', [{ field: 'roleCodes', unknown }]);

  const user = await sequelize.transaction(async (transaction) => {
    const record = await User.create(
      {
        firstName: body.firstName,
        lastName: body.lastName || null,
        email: body.email,
        phone: body.phone || null,
        passwordHash: await hashPassword(body.password),
        dateOfBirth: body.dateOfBirth || null,
        accountStatus: body.accountStatus || ACCOUNT_STATUS.ACTIVE,
        preferredLanguage: body.preferredLanguage || 'en',
        timezone: body.timezone || null,
        createdBy: req.user.id,
      },
      { transaction }
    );

    await UserRole.bulkCreate(
      roles.map((role) => ({ userId: record.id, roleId: role.id, createdBy: req.user.id })),
      { transaction }
    );

    // A staff-created customer still needs a profile for age checks.
    if (body.roleCodes.includes(ROLES.CUSTOMER)) {
      await CustomerProfile.create(
        {
          userId: record.id,
          legalFirstName: body.legalFirstName || body.firstName,
          legalLastName: body.legalLastName || body.lastName || body.firstName,
          dateOfBirth: body.dateOfBirth,
          createdBy: req.user.id,
        },
        { transaction }
      );
    }

    return record;
  });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'User',
    entityId: user.id,
    newValues: { email: user.email, roles: body.roleCodes, accountStatus: user.accountStatus },
    req,
  });

  return detail({ id: user.id });
}

async function update(body, req) {
  const user = await User.findByPk(body.id);
  if (!user) throw AppError.notFound('User not found');

  const before = {
    firstName: user.firstName, lastName: user.lastName, phone: user.phone,
    preferredLanguage: user.preferredLanguage, timezone: user.timezone, isActive: user.isActive,
  };

  if (body.phone && body.phone !== user.phone) {
    const clash = await User.findOne({
      where: { phone: body.phone, id: { [Op.ne]: user.id } },
      paranoid: false,
      attributes: ['id'],
    });
    if (clash) throw AppError.conflict('This phone number is already in use');
  }

  await user.update({
    firstName: body.firstName ?? user.firstName,
    lastName: body.lastName ?? user.lastName,
    phone: body.phone ?? user.phone,
    profileImageUrl: body.profileImageUrl ?? user.profileImageUrl,
    dateOfBirth: body.dateOfBirth ?? user.dateOfBirth,
    preferredLanguage: body.preferredLanguage ?? user.preferredLanguage,
    timezone: body.timezone ?? user.timezone,
    isActive: body.isActive ?? user.isActive,
    updatedBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: 'User',
    entityId: user.id,
    oldValues: before,
    newValues: body,
    req,
  });

  return detail({ id: user.id });
}

/**
 * Changes account status. Suspending, blocking or deleting an account also
 * revokes its sessions, so the change takes effect immediately rather than at
 * access-token expiry.
 */
async function changeStatus(body, req) {
  const user = await User.findByPk(body.id, {
    include: [{ model: Role, as: 'roles', through: { attributes: [] }, required: false }],
  });
  if (!user) throw AppError.notFound('User not found');

  if (Number(user.id) === Number(req.user.id)) {
    throw AppError.badRequest('You cannot change your own account status');
  }

  const isTargetSuperAdmin = (user.roles || []).some((r) => r.code === ROLES.SUPER_ADMIN);
  if (isTargetSuperAdmin && !req.user.isSuperAdmin) {
    throw AppError.forbidden('Only a super administrator may change a super administrator account');
  }

  const previous = user.accountStatus;

  await sequelize.transaction(async (transaction) => {
    await user.update(
      {
        accountStatus: body.accountStatus,
        // Reactivating clears any lockout so the user is not locked out twice.
        loginAttempts: body.accountStatus === ACCOUNT_STATUS.ACTIVE ? 0 : user.loginAttempts,
        lockedUntil: body.accountStatus === ACCOUNT_STATUS.ACTIVE ? null : user.lockedUntil,
        updatedBy: req.user.id,
      },
      { transaction }
    );

    const revokingStatuses = [ACCOUNT_STATUS.SUSPENDED, ACCOUNT_STATUS.BLOCKED, ACCOUNT_STATUS.DELETED];
    if (revokingStatuses.includes(body.accountStatus)) {
      await RefreshToken.update(
        { revokedAt: new Date(), updatedBy: req.user.id },
        { where: { userId: user.id, revokedAt: null }, transaction }
      );
    }
  });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: 'User',
    entityId: user.id,
    oldValues: { accountStatus: previous },
    newValues: { accountStatus: body.accountStatus, reason: body.reason || null },
    req,
  });

  return detail({ id: user.id });
}

/** Soft delete. The row is retained so order history stays attributable. */
async function remove(body, req) {
  const user = await User.findByPk(body.id, {
    include: [{ model: Role, as: 'roles', through: { attributes: [] }, required: false }],
  });
  if (!user) throw AppError.notFound('User not found');

  if (Number(user.id) === Number(req.user.id)) {
    throw AppError.badRequest('You cannot delete your own account');
  }
  if ((user.roles || []).some((r) => r.code === ROLES.SUPER_ADMIN)) {
    throw AppError.forbidden('A super administrator account cannot be deleted');
  }

  await sequelize.transaction(async (transaction) => {
    await user.update(
      { accountStatus: ACCOUNT_STATUS.DELETED, isActive: false, deletedBy: req.user.id },
      { transaction }
    );
    await RefreshToken.update(
      { revokedAt: new Date(), updatedBy: req.user.id },
      { where: { userId: user.id, revokedAt: null }, transaction }
    );
    await user.destroy({ transaction });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_DELETED,
    entityType: 'User',
    entityId: user.id,
    oldValues: { email: user.email },
    newValues: { reason: body.reason || null },
    req,
  });

  return { deleted: true };
}

/** Admin-initiated password reset. Forces the user to sign in again. */
async function resetUserPassword(body, req) {
  const user = await User.findByPk(body.id);
  if (!user) throw AppError.notFound('User not found');

  await sequelize.transaction(async (transaction) => {
    await user.update(
      {
        passwordHash: await hashPassword(body.password),
        loginAttempts: 0,
        lockedUntil: null,
        updatedBy: req.user.id,
      },
      { transaction }
    );
    await RefreshToken.update(
      { revokedAt: new Date(), updatedBy: req.user.id },
      { where: { userId: user.id, revokedAt: null }, transaction }
    );
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
    entityType: 'User',
    entityId: user.id,
    newValues: { method: 'ADMIN_RESET' },
    req,
  });

  return { reset: true };
}

/** Clears a lockout without changing the password. */
async function unlock(body, req) {
  const user = await User.findByPk(body.id);
  if (!user) throw AppError.notFound('User not found');

  await user.update({ loginAttempts: 0, lockedUntil: null, updatedBy: req.user.id });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: 'User',
    entityId: user.id,
    newValues: { unlocked: true },
    req,
  });

  return detail({ id: user.id });
}

module.exports = {
  list, detail, create, update, changeStatus, remove, resetUserPassword, unlock, serialize,
};
