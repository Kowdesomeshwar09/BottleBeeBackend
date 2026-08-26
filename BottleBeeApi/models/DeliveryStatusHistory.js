'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const DeliveryStatusHistory = sequelize.define(
    'DeliveryStatusHistory',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      deliveryAssignmentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      fromStatus: { type: DataTypes.STRING(50), allowNull: true },
      toStatus: { type: DataTypes.STRING(50), allowNull: false },
      changedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('delivery_status_history')
  );

  DeliveryStatusHistory.associate = (models) => {
    DeliveryStatusHistory.belongsTo(models.DeliveryAssignment, {
      foreignKey: 'deliveryAssignmentId',
      as: 'assignment',
    });
    DeliveryStatusHistory.belongsTo(models.User, { foreignKey: 'changedBy', as: 'actor' });
  };

  return DeliveryStatusHistory;
};
