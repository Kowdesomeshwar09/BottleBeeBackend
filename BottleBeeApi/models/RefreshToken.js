'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const RefreshToken = sequelize.define(
    'RefreshToken',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // Only the SHA-256 of the token is stored, so a database leak cannot be
      // replayed as a session.
      tokenHash: { type: DataTypes.STRING(255), allowNull: false },
      deviceId: { type: DataTypes.STRING(255), allowNull: true },
      ipAddress: { type: DataTypes.STRING(80), allowNull: true },
      userAgent: { type: DataTypes.STRING(500), allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      revokedAt: { type: DataTypes.DATE, allowNull: true },
      // Set when this token is rotated. Presenting a token that already has a
      // successor means the token was replayed: the whole chain is revoked.
      replacedByTokenId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('refresh_tokens')
  );

  RefreshToken.associate = (models) => {
    RefreshToken.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  RefreshToken.prototype.isUsable = function isUsable() {
    return !this.revokedAt && new Date(this.expiresAt).getTime() > Date.now();
  };

  return RefreshToken;
};
