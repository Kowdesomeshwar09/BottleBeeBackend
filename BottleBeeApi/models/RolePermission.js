'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define(
    'RolePermission',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      roleId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      permissionId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      ...auditAttributes(DataTypes),
    },
    auditOptions('role_permissions')
  );

  RolePermission.associate = (models) => {
    RolePermission.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
    RolePermission.belongsTo(models.Permission, { foreignKey: 'permissionId', as: 'permission' });
  };

  return RolePermission;
};
