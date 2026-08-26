'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const DeliveryTracking = sequelize.define(
    'DeliveryTracking',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      deliveryAssignmentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      latitude: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
      longitude: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
      recordedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      ...auditAttributes(DataTypes),
    },
    auditOptions('delivery_tracking')
  );

  DeliveryTracking.associate = (models) => {
    DeliveryTracking.belongsTo(models.DeliveryAssignment, {
      foreignKey: 'deliveryAssignmentId',
      as: 'assignment',
    });
  };

  return DeliveryTracking;
};
