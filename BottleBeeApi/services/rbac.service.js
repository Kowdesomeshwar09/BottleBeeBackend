'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Role, Permission, RolePermission, UserRole, User,
} = require('../models');
const { ROLES, AUDIT_ACTIONS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');

/**
 * Roles, permissions and their assignments.
 *
 * Two invariants are enforced here rather than in the database:
 *  1. A system role (seeded) cannot be renamed away from its code or deleted.
 *  2. Nobody may grant SUPER_ADMIN except an existing SUPER_ADMIN. Otherwise an
 *     ADMIN with ROLE_MANAGE could escalate to full platform control.
 */

const ROLE_SORTABLE = ['id', 'code', 'name', 'createdAt', 'updatedAt'];
const PERMISSION_SORTABLE = ['id', 'code', 'module', 'createdAt'];

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

async function listRoles(body, req) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: ROLE_SORTABLE,
    defaultSort: 'code',
    defaultOrder: 'ASC',
  });

  const where = {};
  if (body.search) {
    where[Op.or] = [
      { code: { [Op.like]: `%${body.search}%` } },
      { name: { [Op.like]: `%${body.search}%` } },
    ];
  }
  if (body.isActive !== undefined && body.isActive !== null) where.isActive = body.isActive;

  const result = await Role.findAndCountAll({
    where,
    limit,
    offset,
    order,
    distinct: true,
    include: [{ model: Permission, as: 'permissions', through: { attributes: [] }, required: false }],
  });

  return {
    rows: result.rows.map(serializeRole),
    meta: toPageMeta(result, { page, limit }),
  };
}

async function getRole(body) {
  const role = await Role.findByPk(body.id, {
    include: [{ model: Permission, as: 'permissions', through: { attributes: [] }, required: false }],
  });
  if (!role) throw AppError.notFound('Role not found');
  return serializeRole(role);
}

async function createRole(body, req) {
  const existing = await Role.findOne({ where: { code: body.code }, paranoid: false });
  if (existing) throw AppError.conflict('A role with this code already exists');

  const role = await sequelize.transaction(async (transaction) => {
    const created = await Role.create(
      {
        code: body.code,
        name: body.name,
        description: body.description || null,
        // Only the seeders create system roles.
        isSystem: false,
        createdBy: req.user.id,
      },
      { transaction }
    );

    if (body.permissionCodes?.length) {
      await replacePermissions(created, body.permissionCodes, req, transaction);
    }
    return created;
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
    entityType: 'Role',
    entityId: role.id,
    newValues: { code: role.code, permissionCodes: body.permissionCodes || [] },
    req,
  });

  return getRole({ id: role.id });
}

async function updateRole(body, req) {
  const role = await Role.findByPk(body.id);
  if (!role) throw AppError.notFound('Role not found');

  if (role.isSystem && body.code && body.code !== role.code) {
    throw AppError.forbidden('The code of a system role cannot be changed');
  }

  const before = { code: role.code, name: role.name, description: role.description };

  await role.update({
    code: body.code ?? role.code,
    name: body.name ?? role.name,
    description: body.description ?? role.description,
    isActive: body.isActive ?? role.isActive,
    updatedBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
    entityType: 'Role',
    entityId: role.id,
    oldValues: before,
    newValues: { code: role.code, name: role.name, description: role.description },
    req,
  });

  return getRole({ id: role.id });
}

async function deleteRole(body, req) {
  const role = await Role.findByPk(body.id);
  if (!role) throw AppError.notFound('Role not found');
  if (role.isSystem) throw AppError.forbidden('A system role cannot be deleted');

  const assigned = await UserRole.count({ where: { roleId: role.id } });
  if (assigned > 0) {
    throw AppError.conflict(
      `This role is assigned to ${assigned} user(s). Reassign them before deleting the role.`
    );
  }

  await sequelize.transaction(async (transaction) => {
    await RolePermission.destroy({ where: { roleId: role.id }, transaction });
    await role.update({ deletedBy: req.user.id }, { transaction });
    await role.destroy({ transaction });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
    entityType: 'Role',
    entityId: role.id,
    oldValues: { code: role.code },
    newValues: { deleted: true },
    req,
  });

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

async function listPermissions(body) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: PERMISSION_SORTABLE,
    defaultSort: 'module',
    defaultOrder: 'ASC',
  });

  const where = {};
  if (body.module) where.module = body.module;
  if (body.search) {
    where[Op.or] = [
      { code: { [Op.like]: `%${body.search}%` } },
      { description: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const result = await Permission.findAndCountAll({ where, limit, offset, order });

  return {
    rows: result.rows.map((p) => ({
      id: p.id, code: p.code, module: p.module, description: p.description,
    })),
    meta: toPageMeta(result, { page, limit }),
  };
}

/** Permissions grouped by module — the shape the admin UI renders. */
async function permissionMatrix() {
  const permissions = await Permission.findAll({ order: [['module', 'ASC'], ['code', 'ASC']] });

  const modules = permissions.reduce((acc, p) => {
    acc[p.module] = acc[p.module] || [];
    acc[p.module].push({ id: p.id, code: p.code, description: p.description });
    return acc;
  }, {});

  const roles = await Role.findAll({
    include: [{ model: Permission, as: 'permissions', through: { attributes: [] }, required: false }],
    order: [['code', 'ASC']],
  });

  return {
    modules,
    roles: roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      permissionCodes: (role.permissions || []).map((p) => p.code),
    })),
  };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** Replaces a role's permission set wholesale. */
async function replacePermissions(role, permissionCodes, req, transaction) {
  const permissions = await Permission.findAll({
    where: { code: { [Op.in]: permissionCodes } },
    transaction,
  });

  const found = permissions.map((p) => p.code);
  const unknown = permissionCodes.filter((code) => !found.includes(code));
  if (unknown.length) {
    throw AppError.badRequest('Unknown permission codes', [
      { field: 'permissionCodes', unknown },
    ]);
  }

  await RolePermission.destroy({ where: { roleId: role.id }, transaction, force: true });

  await RolePermission.bulkCreate(
    permissions.map((p) => ({ roleId: role.id, permissionId: p.id, createdBy: req.user.id })),
    { transaction }
  );

  return found;
}

async function setRolePermissions(body, req) {
  const role = await Role.findByPk(body.roleId);
  if (!role) throw AppError.notFound('Role not found');

  if (role.code === ROLES.SUPER_ADMIN && !req.user.isSuperAdmin) {
    throw AppError.forbidden('Only a super administrator may change super administrator permissions');
  }

  const before = await RolePermission.findAll({
    where: { roleId: role.id },
    include: [{ model: Permission, as: 'permission', attributes: ['code'] }],
  });

  const applied = await sequelize.transaction((transaction) =>
    replacePermissions(role, body.permissionCodes, req, transaction));

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
    entityType: 'Role',
    entityId: role.id,
    oldValues: { permissionCodes: before.map((rp) => rp.permission?.code).filter(Boolean) },
    newValues: { permissionCodes: applied },
    req,
  });

  return getRole({ id: role.id });
}

/**
 * Replaces a user's role set.
 *
 * Guards against privilege escalation: granting or removing SUPER_ADMIN
 * requires the actor to be a SUPER_ADMIN, and the last remaining super admin
 * cannot be demoted, which would lock everyone out of the platform.
 */
async function assignRolesToUser(body, req) {
  const user = await User.findByPk(body.userId, {
    include: [{ model: Role, as: 'roles', through: { attributes: [] } }],
  });
  if (!user) throw AppError.notFound('User not found');

  const roles = await Role.findAll({ where: { code: { [Op.in]: body.roleCodes } } });
  const found = roles.map((r) => r.code);
  const unknown = body.roleCodes.filter((code) => !found.includes(code));
  if (unknown.length) {
    throw AppError.badRequest('Unknown role codes', [{ field: 'roleCodes', unknown }]);
  }

  const currentCodes = (user.roles || []).map((r) => r.code);
  const grantingSuperAdmin = found.includes(ROLES.SUPER_ADMIN) && !currentCodes.includes(ROLES.SUPER_ADMIN);
  const removingSuperAdmin = currentCodes.includes(ROLES.SUPER_ADMIN) && !found.includes(ROLES.SUPER_ADMIN);

  if ((grantingSuperAdmin || removingSuperAdmin) && !req.user.isSuperAdmin) {
    throw AppError.forbidden('Only a super administrator may grant or revoke the super administrator role');
  }

  if (removingSuperAdmin) {
    const superAdminRole = await Role.findOne({ where: { code: ROLES.SUPER_ADMIN } });
    const remaining = await UserRole.count({
      where: { roleId: superAdminRole.id, userId: { [Op.ne]: user.id } },
    });
    if (remaining === 0) {
      throw AppError.conflict('This is the last super administrator. Promote another user first.');
    }
  }

  await sequelize.transaction(async (transaction) => {
    await UserRole.destroy({ where: { userId: user.id }, transaction, force: true });
    await UserRole.bulkCreate(
      roles.map((role) => ({ userId: user.id, roleId: role.id, createdBy: req.user.id })),
      { transaction }
    );
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ROLES_ASSIGNED,
    entityType: 'User',
    entityId: user.id,
    oldValues: { roles: currentCodes },
    newValues: { roles: found },
    req,
  });

  return { userId: user.id, roles: found };
}

function serializeRole(role) {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isActive: role.isActive,
    permissionCodes: (role.permissions || []).map((p) => p.code),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  permissionMatrix,
  setRolePermissions,
  assignRolesToUser,
};
