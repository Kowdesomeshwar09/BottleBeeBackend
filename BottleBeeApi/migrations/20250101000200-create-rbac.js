'use strict';

const { primaryKey, fk, auditColumns, tableOptions, applyAuditBehaviour } = require('../utils/migrationColumns');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'roles',
      {
        id: primaryKey(Sequelize),
        code: { type: DataTypes.STRING(80), allowNull: false },
        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.STRING(255), allowNull: true },
        is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('roles', ['code'], { unique: true, name: 'uq_roles_code' });
    await applyAuditBehaviour(queryInterface, 'roles');

    await queryInterface.createTable(
      'permissions',
      {
        id: primaryKey(Sequelize),
        code: { type: DataTypes.STRING(100), allowNull: false },
        module: { type: DataTypes.STRING(100), allowNull: false },
        description: { type: DataTypes.STRING(255), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('permissions', ['code'], { unique: true, name: 'uq_permissions_code' });
    await queryInterface.addIndex('permissions', ['module'], { name: 'idx_permissions_module' });
    await applyAuditBehaviour(queryInterface, 'permissions');

    await queryInterface.createTable(
      'user_roles',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        role_id: fk(Sequelize, { table: 'roles', onDelete: 'CASCADE' }),
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('user_roles', ['user_id', 'role_id'], {
      unique: true,
      name: 'uq_user_roles',
    });
    await applyAuditBehaviour(queryInterface, 'user_roles');

    await queryInterface.createTable(
      'role_permissions',
      {
        id: primaryKey(Sequelize),
        role_id: fk(Sequelize, { table: 'roles', onDelete: 'CASCADE' }),
        permission_id: fk(Sequelize, { table: 'permissions', onDelete: 'CASCADE' }),
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('role_permissions', ['role_id', 'permission_id'], {
      unique: true,
      name: 'uq_role_permissions',
    });
    await applyAuditBehaviour(queryInterface, 'role_permissions');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('role_permissions');
    await queryInterface.dropTable('user_roles');
    await queryInterface.dropTable('permissions');
    await queryInterface.dropTable('roles');
  },
};
