'use strict';

const {
  ROLE_DEFINITIONS, PERMISSION_DEFINITIONS, ROLE_PERMISSIONS,
} = require('../config/constants');

/**
 * Seeds roles, permissions and the role/permission matrix from
 * config/constants.js, which is the single source of truth.
 *
 * The seeder is idempotent: re-running it inserts anything new and leaves
 * existing rows alone, so adding a permission to constants and re-seeding is a
 * safe way to roll it out.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const sequelize = queryInterface.sequelize;

    // --- Roles -------------------------------------------------------------
    const existingRoles = await sequelize.query(
      'SELECT code FROM roles',
      { type: sequelize.QueryTypes.SELECT }
    );
    const knownRoleCodes = new Set(existingRoles.map((r) => r.code));

    const newRoles = ROLE_DEFINITIONS
      .filter((role) => !knownRoleCodes.has(role.code))
      .map((role) => ({
        code: role.code,
        name: role.name,
        description: role.description,
        is_system: true,
        created_at: now,
        is_active: true,
      }));

    if (newRoles.length) await queryInterface.bulkInsert('roles', newRoles);

    // --- Permissions -------------------------------------------------------
    const existingPermissions = await sequelize.query(
      'SELECT code FROM permissions',
      { type: sequelize.QueryTypes.SELECT }
    );
    const knownPermissionCodes = new Set(existingPermissions.map((p) => p.code));

    const newPermissions = PERMISSION_DEFINITIONS
      .filter((permission) => !knownPermissionCodes.has(permission.code))
      .map((permission) => ({
        code: permission.code,
        module: permission.module,
        description: permission.description,
        created_at: now,
        is_active: true,
      }));

    if (newPermissions.length) await queryInterface.bulkInsert('permissions', newPermissions);

    // --- Role / permission matrix -----------------------------------------
    const roles = await sequelize.query(
      'SELECT id, code FROM roles',
      { type: sequelize.QueryTypes.SELECT }
    );
    const permissions = await sequelize.query(
      'SELECT id, code FROM permissions',
      { type: sequelize.QueryTypes.SELECT }
    );
    const existingLinks = await sequelize.query(
      'SELECT role_id, permission_id FROM role_permissions',
      { type: sequelize.QueryTypes.SELECT }
    );

    const roleIdByCode = new Map(roles.map((r) => [r.code, r.id]));
    const permissionIdByCode = new Map(permissions.map((p) => [p.code, p.id]));
    const linked = new Set(existingLinks.map((l) => `${l.role_id}:${l.permission_id}`));

    const newLinks = [];
    Object.entries(ROLE_PERMISSIONS).forEach(([roleCode, permissionCodes]) => {
      const roleId = roleIdByCode.get(roleCode);
      if (!roleId) return;

      permissionCodes.forEach((permissionCode) => {
        const permissionId = permissionIdByCode.get(permissionCode);
        if (!permissionId) return;
        if (linked.has(`${roleId}:${permissionId}`)) return;

        newLinks.push({
          role_id: roleId,
          permission_id: permissionId,
          created_at: now,
          is_active: true,
        });
      });
    });

    if (newLinks.length) await queryInterface.bulkInsert('role_permissions', newLinks);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('role_permissions', null, {});
    await queryInterface.bulkDelete('permissions', null, {});
    await queryInterface.bulkDelete('roles', null, {});
  },
};
