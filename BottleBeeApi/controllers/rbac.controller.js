'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Role, Permission, RolePermission, UserRole, User,
} = require('../models');
const { ROLES, AUDIT_ACTIONS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');

/**
 * Roles, permissions and their assignments.
 *
 * Two invariants are enforced here rather than in the database, because both
 * depend on who is asking:
 *
 *  1. A seeded system role cannot be renamed away from its code or deleted.
 *  2. Only an existing SUPER_ADMIN may grant or revoke SUPER_ADMIN, and the last
 *     remaining super administrator cannot be demoted. Without the first rule an
 *     ADMIN holding ROLE_MANAGE could escalate themselves to full control;
 *     without the second, a single demotion could lock everyone out of the
 *     platform permanently.
 */

const ROLE_SORTABLE = ['id', 'code', 'name', 'createdAt', 'updatedAt'];
const PERMISSION_SORTABLE = ['id', 'code', 'module', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serializeRole = (role) => ({
  id: role.id,
  code: role.code,
  name: role.name,
  description: role.description,
  isSystem: role.isSystem,
  isActive: role.isActive,
  permissionCodes: (role.permissions || []).map((p) => p.code),
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

const findRoleWithPermissions = (id) => Role.findByPk(id, {
  include: [{ model: Permission, as: 'permissions', through: { attributes: [] }, required: false }],
});

/**
 * Replaces a role's permission set wholesale. Rows are force-deleted rather
 * than soft-deleted: `(role_id, permission_id)` is unique, so a soft-deleted
 * grant would block ever re-granting that permission.
 */
async function replacePermissions(role, permissionCodes, actorId, transaction) {
  const permissions = await Permission.findAll({
    where: { code: { [Op.in]: permissionCodes } },
    transaction,
  });

  const found = permissions.map((p) => p.code);
  const unknown = permissionCodes.filter((code) => !found.includes(code));
  if (unknown.length) {
    const error = new Error('Unknown permission codes');
    error.unknown = unknown;
    throw error;
  }

  await RolePermission.destroy({ where: { roleId: role.id }, transaction, force: true });

  await RolePermission.bulkCreate(
    permissions.map((p) => ({ roleId: role.id, permissionId: p.id, createdBy: actorId })),
    { transaction }
  );

  return found;
}

/* -------------------------------------------------------------------------- */
/*                                LIST ROLES                                  */
/* -------------------------------------------------------------------------- */
const listRoles = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: ROLE_SORTABLE,
      defaultSort: 'code',
      defaultOrder: 'ASC',
    });

    const where = {};
    if (req.body.search) {
      where[Op.or] = [
        { code: { [Op.like]: `%${req.body.search}%` } },
        { name: { [Op.like]: `%${req.body.search}%` } },
      ];
    }
    if (req.body.isActive !== undefined && req.body.isActive !== null) {
      where.isActive = req.body.isActive;
    }

    const result = await Role.findAndCountAll({
      where,
      include: [{ model: Permission, as: 'permissions', through: { attributes: [] }, required: false }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map(serializeRole),
      toPageMeta(result, { page, limit }),
      'Roles fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching roles', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                               GET ONE ROLE                                 */
/* -------------------------------------------------------------------------- */
const getRole = async (req, res) => {
  try {
    const role = await findRoleWithPermissions(req.body.id);
    if (!role) return fail(res, 'Role not found', 404);

    return ok(res, serializeRole(role), 'Role fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching role', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              CREATE A ROLE                                 */
/* -------------------------------------------------------------------------- */
const createRole = async (req, res) => {
  try {
    const existing = await Role.findOne({ where: { code: req.body.code }, paranoid: false });
    if (existing) return fail(res, 'A role with this code already exists', 409);

    let role;
    try {
      role = await sequelize.transaction(async (transaction) => {
        const record = await Role.create(
          {
            code: req.body.code,
            name: req.body.name,
            description: req.body.description || null,
            // Only the seeders create system roles.
            isSystem: false,
            createdBy: req.user.id,
          },
          { transaction }
        );

        if (req.body.permissionCodes?.length) {
          await replacePermissions(record, req.body.permissionCodes, req.user.id, transaction);
        }
        return record;
      });
    } catch (error) {
      if (error.unknown) {
        return fail(res, 'Unknown permission codes', 400, [
          { field: 'permissionCodes', unknown: error.unknown },
        ]);
      }
      throw error;
    }

    await recordAudit({
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
      entityType: 'Role',
      entityId: role.id,
      newValues: { code: role.code, permissionCodes: req.body.permissionCodes || [] },
      req,
    });

    const fresh = await findRoleWithPermissions(role.id);
    return created(res, serializeRole(fresh), 'Role created successfully');
  } catch (error) {
    return fail(res, 'Error creating role', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              UPDATE A ROLE                                 */
/* -------------------------------------------------------------------------- */
const updateRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.body.id);
    if (!role) return fail(res, 'Role not found', 404);

    if (role.isSystem && req.body.code && req.body.code !== role.code) {
      return fail(res, 'The code of a system role cannot be changed', 403);
    }

    const before = { code: role.code, name: role.name, description: role.description };

    await role.update({
      code: req.body.code ?? role.code,
      name: req.body.name ?? role.name,
      description: req.body.description ?? role.description,
      isActive: req.body.isActive ?? role.isActive,
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

    const fresh = await findRoleWithPermissions(role.id);
    return updated(res, serializeRole(fresh), 'Role updated successfully');
  } catch (error) {
    return fail(res, 'Error updating role', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              DELETE A ROLE                                 */
/* -------------------------------------------------------------------------- */
const deleteRole = async (req, res) => {
  try {
    const role = await Role.findByPk(req.body.id);
    if (!role) return fail(res, 'Role not found', 404);
    if (role.isSystem) return fail(res, 'A system role cannot be deleted', 403);

    const assigned = await UserRole.count({ where: { roleId: role.id } });
    if (assigned > 0) {
      return fail(
        res,
        `This role is assigned to ${assigned} user(s). Reassign them before deleting the role.`,
        409
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

    return deleted(res, 'Role deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting role', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            LIST PERMISSIONS                                */
/* -------------------------------------------------------------------------- */
const listPermissions = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: PERMISSION_SORTABLE,
      defaultSort: 'module',
      defaultOrder: 'ASC',
    });

    const where = {};
    if (req.body.module) where.module = req.body.module;
    if (req.body.search) {
      where[Op.or] = [
        { code: { [Op.like]: `%${req.body.search}%` } },
        { description: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await Permission.findAndCountAll({ where, limit, offset, order });

    return paginated(
      res,
      result.rows.map((p) => ({
        id: p.id, code: p.code, module: p.module, description: p.description,
      })),
      toPageMeta(result, { page, limit }),
      'Permissions fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching permissions', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                           PERMISSION MATRIX                                */
/* -------------------------------------------------------------------------- */
/** Permissions grouped by module plus every role's grants — the admin RBAC screen. */
const permissionMatrix = async (req, res) => {
  try {
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

    return ok(
      res,
      {
        modules,
        roles: roles.map((role) => ({
          id: role.id,
          code: role.code,
          name: role.name,
          isSystem: role.isSystem,
          permissionCodes: (role.permissions || []).map((p) => p.code),
        })),
      },
      'Permission matrix fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error building permission matrix', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                      REPLACE A ROLE'S PERMISSIONS                          */
/* -------------------------------------------------------------------------- */
const setRolePermissions = async (req, res) => {
  try {
    const role = await Role.findByPk(req.body.roleId);
    if (!role) return fail(res, 'Role not found', 404);

    if (role.code === ROLES.SUPER_ADMIN && !req.user.isSuperAdmin) {
      return fail(res, 'Only a super administrator may change super administrator permissions', 403);
    }

    const before = await RolePermission.findAll({
      where: { roleId: role.id },
      include: [{ model: Permission, as: 'permission', attributes: ['code'] }],
    });

    let applied;
    try {
      applied = await sequelize.transaction((transaction) =>
        replacePermissions(role, req.body.permissionCodes, req.user.id, transaction));
    } catch (error) {
      if (error.unknown) {
        return fail(res, 'Unknown permission codes', 400, [
          { field: 'permissionCodes', unknown: error.unknown },
        ]);
      }
      throw error;
    }

    await recordAudit({
      action: AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED,
      entityType: 'Role',
      entityId: role.id,
      oldValues: { permissionCodes: before.map((rp) => rp.permission?.code).filter(Boolean) },
      newValues: { permissionCodes: applied },
      req,
    });

    const fresh = await findRoleWithPermissions(role.id);
    return updated(res, serializeRole(fresh), 'Role permissions updated successfully');
  } catch (error) {
    return fail(res, 'Error updating role permissions', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                         ASSIGN ROLES TO A USER                             */
/* -------------------------------------------------------------------------- */
/**
 * Replaces a user's role set. Guards against privilege escalation and against
 * demoting the last super administrator.
 */
const assignRoles = async (req, res) => {
  try {
    const user = await User.findByPk(req.body.userId, {
      include: [{ model: Role, as: 'roles', through: { attributes: [] } }],
    });
    if (!user) return fail(res, 'User not found', 404);

    const roles = await Role.findAll({ where: { code: { [Op.in]: req.body.roleCodes } } });
    const found = roles.map((r) => r.code);
    const unknown = req.body.roleCodes.filter((code) => !found.includes(code));
    if (unknown.length) {
      return fail(res, 'Unknown role codes', 400, [{ field: 'roleCodes', unknown }]);
    }

    const currentCodes = (user.roles || []).map((r) => r.code);
    const granting = found.includes(ROLES.SUPER_ADMIN) && !currentCodes.includes(ROLES.SUPER_ADMIN);
    const revoking = currentCodes.includes(ROLES.SUPER_ADMIN) && !found.includes(ROLES.SUPER_ADMIN);

    if ((granting || revoking) && !req.user.isSuperAdmin) {
      return fail(
        res,
        'Only a super administrator may grant or revoke the super administrator role',
        403
      );
    }

    if (revoking) {
      const superAdminRole = await Role.findOne({ where: { code: ROLES.SUPER_ADMIN } });
      const remaining = await UserRole.count({
        where: { roleId: superAdminRole.id, userId: { [Op.ne]: user.id } },
      });
      if (remaining === 0) {
        return fail(
          res,
          'This is the last super administrator. Promote another user first.',
          409
        );
      }
    }

    await sequelize.transaction(async (transaction) => {
      // Force delete: (user_id, role_id) is unique, so a soft-deleted row would
      // block re-granting the same role later.
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

    return updated(res, { userId: user.id, roles: found }, 'Roles assigned successfully');
  } catch (error) {
    return fail(res, 'Error assigning roles', 500, [{ message: error.message }]);
  }
};

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
