'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    'Role',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      code: {
        type: DataTypes.STRING(80),
        allowNull: false,
        set(value) {
          this.setDataValue('code', String(value || '').trim().toUpperCase());
        },
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.STRING(255), allowNull: true },
      // System roles are seeded and may not be renamed or deleted.
      isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ...auditAttributes(DataTypes),
    },
    auditOptions('roles')
  );

  Role.associate = (models) => {
    Role.belongsToMany(models.User, {
      through: models.UserRole,
      foreignKey: 'roleId',
      otherKey: 'userId',
      as: 'users',
    });
    Role.belongsToMany(models.Permission, {
      through: models.RolePermission,
      foreignKey: 'roleId',
      otherKey: 'permissionId',
      as: 'permissions',
    });
    Role.hasMany(models.RolePermission, { foreignKey: 'roleId', as: 'rolePermissions' });
    Role.hasMany(models.UserRole, { foreignKey: 'roleId', as: 'userRoles' });
  };

  return Role;
};
