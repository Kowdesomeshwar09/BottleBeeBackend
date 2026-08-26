'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const Permission = sequelize.define(
    'Permission',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
        set(value) {
          this.setDataValue('code', String(value || '').trim().toUpperCase());
        },
      },
      module: { type: DataTypes.STRING(100), allowNull: false },
      description: { type: DataTypes.STRING(255), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('permissions')
  );

  Permission.associate = (models) => {
    Permission.belongsToMany(models.Role, {
      through: models.RolePermission,
      foreignKey: 'permissionId',
      otherKey: 'roleId',
      as: 'roles',
    });
    Permission.hasMany(models.RolePermission, { foreignKey: 'permissionId', as: 'rolePermissions' });
  };

  return Permission;
};
