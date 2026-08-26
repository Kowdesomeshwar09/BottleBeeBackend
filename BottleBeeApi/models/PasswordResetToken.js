'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const PasswordResetToken = sequelize.define(
    'PasswordResetToken',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      tokenHash: { type: DataTypes.STRING(255), allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      usedAt: { type: DataTypes.DATE, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('password_reset_tokens')
  );

  PasswordResetToken.associate = (models) => {
    PasswordResetToken.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  PasswordResetToken.prototype.isUsable = function isUsable() {
    return !this.usedAt && new Date(this.expiresAt).getTime() > Date.now();
  };

  return PasswordResetToken;
};
