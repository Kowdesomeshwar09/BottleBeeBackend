'use strict';

/**
 * Append-only audit trail. Deliberately the one model without the standard
 * audit block: rows are never updated or deleted, so `updated_*`, `deleted_*`
 * and `is_active` would be meaningless.
 */
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      actorUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      action: { type: DataTypes.STRING(120), allowNull: false },
      entityType: { type: DataTypes.STRING(120), allowNull: false },
      entityId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      oldValues: { type: DataTypes.JSON, allowNull: true },
      newValues: { type: DataTypes.JSON, allowNull: true },
      ipAddress: { type: DataTypes.STRING(80), allowNull: true },
      userAgent: { type: DataTypes.STRING(500), allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'audit_logs',
      timestamps: true,
      updatedAt: false,
      paranoid: false,
      underscored: true,
    }
  );

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.User, { foreignKey: 'actorUserId', as: 'actor' });
  };

  return AuditLog;
};
