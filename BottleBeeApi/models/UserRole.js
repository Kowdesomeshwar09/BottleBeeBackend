'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define(
    'UserRole',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      roleId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      ...auditAttributes(DataTypes),
    },
    auditOptions('user_roles')
  );

  UserRole.associate = (models) => {
    UserRole.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    UserRole.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
  };

  return UserRole;
};
