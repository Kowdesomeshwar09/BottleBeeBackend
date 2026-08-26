'use strict';

const { Op } = require('sequelize');

const {
  sequelize, User, Role, UserRole, CustomerProfile, RefreshToken,
} = require('../models');
const { ROLES, ACCOUNT_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { hashPassword } = require('../utils/crypto');
const { recordAudit } = require('../utils/audit');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');

/**
 * User administration.
 *
 * Self-service profile edits live in `customer.controller.js`; this module is
 * the staff-facing surface. Three rules are enforced here rather than in
 * validation, because they depend on database state:
 *
 *  - Only a SUPER_ADMIN may create, alter or delete another SUPER_ADMIN.
 *  - Nobody may change or delete their own account through these endpoints.
 *  - Suspending, blocking or deleting an account revokes its sessions in the
 *    same transaction, so access ends immediately rather than at token expiry.
 */

const SORTABLE = ['id', 'firstName', 'lastName', 'email', 'accountStatus', 'lastLoginAt', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serializeUser = (user) => ({
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
});

/** Loads a user with roles and customer profile, for detail responses. */
const findUserWithRelations = (id) => User.findByPk(id, {
  include: [
    { model: Role, as: 'roles', through: { attributes: [] }, required: false },
    { model: CustomerProfile, as: 'customerProfile', required: false },
  ],
});

const buildDetail = (user) => ({
  ...serializeUser(user),
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
});

const holdsSuperAdmin = (user) => (user.roles || []).some((r) => r.code === ROLES.SUPER_ADMIN);

/** Revokes every live session for a user. Joins the caller's transaction. */
const revokeSessions = (userId, actorId, transaction) => RefreshToken.update(
  { revokedAt: new Date(), updatedBy: actorId },
  { where: { userId, revokedAt: null }, transaction }
);

/* -------------------------------------------------------------------------- */
/*                                LIST USERS                                  */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {};
    if (req.body.accountStatus) where.accountStatus = req.body.accountStatus;
    if (req.body.isActive !== undefined && req.body.isActive !== null) {
      where.isActive = req.body.isActive;
    }
    if (req.body.search) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${req.body.search}%` } },
        { lastName: { [Op.like]: `%${req.body.search}%` } },
        { email: { [Op.like]: `%${req.body.search}%` } },
        { phone: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await User.findAndCountAll({
      where,
      include: [{
        model: Role,
        as: 'roles',
        through: { attributes: [] },
        required: !!req.body.roleCode,
        ...(req.body.roleCode ? { where: { code: req.body.roleCode } } : {}),
      }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map(serializeUser),
      toPageMeta(result, { page, limit }),
      'Users fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching users', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                               GET ONE USER                                 */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const user = await findUserWithRelations(req.body.id);
    if (!user) return fail(res, 'User not found', 404);

    return ok(res, buildDetail(user), 'User fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching user', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                               CREATE USER                                  */
/* -------------------------------------------------------------------------- */
/**
 * Staff-created account. A CUSTOMER also gets a customer profile, because age
 * eligibility depends on a date of birth and checkout would be un-evaluable
 * without one.
 */
const create = async (req, res) => {
  try {
    const { body } = req;

    const clash = await User.findOne({
      where: {
        [Op.or]: [
          { email: String(body.email).toLowerCase() },
          ...(body.phone ? [{ phone: body.phone }] : []),
        ],
      },
      paranoid: false,
      attributes: ['id', 'email'],
    });
    if (clash) return fail(res, 'A user with this email or phone already exists', 409);

    if (body.roleCodes.includes(ROLES.SUPER_ADMIN) && !req.user.isSuperAdmin) {
      return fail(res, 'Only a super administrator may create another super administrator', 403);
    }

    const roles = await Role.findAll({ where: { code: { [Op.in]: body.roleCodes } } });
    const unknown = body.roleCodes.filter((code) => !roles.some((r) => r.code === code));
    if (unknown.length) {
      return fail(res, 'Unknown role codes', 400, [{ field: 'roleCodes', unknown }]);
    }

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

      if (body.roleCodes.includes(ROLES.CUSTOMER)) {
        await CustomerProfile.create(
          {
            userId: record.id,
            legalFirstName: body.legalFirstName || body.firstName,
            legalLastName: body.legalLastName || body.lastName || body.firstName,
            dateOfBirth: body.dateOfBirth,
            gender: body.gender || null,
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

    const fresh = await findUserWithRelations(user.id);
    return created(res, buildDetail(fresh), 'User created successfully');
  } catch (error) {
    return fail(res, 'Error creating user', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                               UPDATE USER                                  */
/* -------------------------------------------------------------------------- */
/** Email and roles are deliberately not editable here — each has its own endpoint. */
const update = async (req, res) => {
  try {
    const { body } = req;

    const user = await User.findByPk(body.id);
    if (!user) return fail(res, 'User not found', 404);

    if (body.phone && body.phone !== user.phone) {
      const clash = await User.findOne({
        where: { phone: body.phone, id: { [Op.ne]: user.id } },
        paranoid: false,
        attributes: ['id'],
      });
      if (clash) return fail(res, 'This phone number is already in use', 409);
    }

    const before = {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      preferredLanguage: user.preferredLanguage,
      timezone: user.timezone,
      isActive: user.isActive,
    };

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

    const fresh = await findUserWithRelations(user.id);
    return updated(res, buildDetail(fresh), 'User updated successfully');
  } catch (error) {
    return fail(res, 'Error updating user', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          CHANGE ACCOUNT STATUS                             */
/* -------------------------------------------------------------------------- */
/**
 * Suspend, block, activate or restore an account. A status that removes access
 * also revokes live sessions inside the same transaction, so a suspended user
 * cannot keep working until their access token happens to expire.
 */
const changeStatus = async (req, res) => {
  try {
    const user = await User.findByPk(req.body.id, {
      include: [{ model: Role, as: 'roles', through: { attributes: [] }, required: false }],
    });
    if (!user) return fail(res, 'User not found', 404);

    if (Number(user.id) === Number(req.user.id)) {
      return fail(res, 'You cannot change your own account status', 400);
    }
    if (holdsSuperAdmin(user) && !req.user.isSuperAdmin) {
      return fail(res, 'Only a super administrator may change a super administrator account', 403);
    }

    const previous = user.accountStatus;
    const isReactivating = req.body.accountStatus === ACCOUNT_STATUS.ACTIVE;
    const revokes = [
      ACCOUNT_STATUS.SUSPENDED, ACCOUNT_STATUS.BLOCKED, ACCOUNT_STATUS.DELETED,
    ].includes(req.body.accountStatus);

    await sequelize.transaction(async (transaction) => {
      await user.update(
        {
          accountStatus: req.body.accountStatus,
          // Reactivating clears any lockout, so the user is not locked out twice.
          loginAttempts: isReactivating ? 0 : user.loginAttempts,
          lockedUntil: isReactivating ? null : user.lockedUntil,
          updatedBy: req.user.id,
        },
        { transaction }
      );

      if (revokes) await revokeSessions(user.id, req.user.id, transaction);
    });

    await recordAudit({
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      entityType: 'User',
      entityId: user.id,
      oldValues: { accountStatus: previous },
      newValues: { accountStatus: req.body.accountStatus, reason: req.body.reason || null },
      req,
    });

    const fresh = await findUserWithRelations(user.id);
    return updated(res, buildDetail(fresh), 'Account status updated successfully');
  } catch (error) {
    return fail(res, 'Error updating account status', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                                DELETE USER                                 */
/* -------------------------------------------------------------------------- */
/** Soft delete: the row is retained so historical orders stay attributable. */
const remove = async (req, res) => {
  try {
    const user = await User.findByPk(req.body.id, {
      include: [{ model: Role, as: 'roles', through: { attributes: [] }, required: false }],
    });
    if (!user) return fail(res, 'User not found', 404);

    if (Number(user.id) === Number(req.user.id)) {
      return fail(res, 'You cannot delete your own account', 400);
    }
    if (holdsSuperAdmin(user)) {
      return fail(res, 'A super administrator account cannot be deleted', 403);
    }

    await sequelize.transaction(async (transaction) => {
      await user.update(
        { accountStatus: ACCOUNT_STATUS.DELETED, isActive: false, deletedBy: req.user.id },
        { transaction }
      );
      await revokeSessions(user.id, req.user.id, transaction);
      await user.destroy({ transaction });
    });

    await recordAudit({
      action: AUDIT_ACTIONS.USER_DELETED,
      entityType: 'User',
      entityId: user.id,
      oldValues: { email: user.email },
      newValues: { reason: req.body.reason || null },
      req,
    });

    return deleted(res, 'User deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting user', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       ADMIN-INITIATED PASSWORD RESET                       */
/* -------------------------------------------------------------------------- */
const resetPassword = async (req, res) => {
  try {
    const user = await User.findByPk(req.body.id);
    if (!user) return fail(res, 'User not found', 404);

    await sequelize.transaction(async (transaction) => {
      await user.update(
        {
          passwordHash: await hashPassword(req.body.password),
          loginAttempts: 0,
          lockedUntil: null,
          updatedBy: req.user.id,
        },
        { transaction }
      );
      // A password change must end every existing session.
      await revokeSessions(user.id, req.user.id, transaction);
    });

    await recordAudit({
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      entityType: 'User',
      entityId: user.id,
      newValues: { method: 'ADMIN_RESET' },
      req,
    });

    return ok(res, { reset: true }, 'Password reset successfully');
  } catch (error) {
    return fail(res, 'Error resetting password', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        CLEAR A FAILED-LOGIN LOCKOUT                        */
/* -------------------------------------------------------------------------- */
const unlock = async (req, res) => {
  try {
    const user = await User.findByPk(req.body.id);
    if (!user) return fail(res, 'User not found', 404);

    await user.update({ loginAttempts: 0, lockedUntil: null, updatedBy: req.user.id });

    await recordAudit({
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: user.id,
      newValues: { unlocked: true },
      req,
    });

    const fresh = await findUserWithRelations(user.id);
    return updated(res, buildDetail(fresh), 'Account unlocked successfully');
  } catch (error) {
    return fail(res, 'Error unlocking account', 500, [{ message: error.message }]);
  }
};

module.exports = {
  list, detail, create, update, changeStatus, remove, resetPassword, unlock, serializeUser,
};
