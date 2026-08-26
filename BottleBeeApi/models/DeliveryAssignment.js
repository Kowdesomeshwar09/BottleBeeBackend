'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { DELIVERY_ASSIGNMENT_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const DeliveryAssignment = sequelize.define(
    'DeliveryAssignment',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      orderId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      deliveryPartnerId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      assignedAt: { type: DataTypes.DATE, allowNull: false },
      acceptedAt: { type: DataTypes.DATE, allowNull: true },
      rejectedAt: { type: DataTypes.DATE, allowNull: true },
      pickedUpAt: { type: DataTypes.DATE, allowNull: true },
      deliveredAt: { type: DataTypes.DATE, allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(DELIVERY_ASSIGNMENT_STATUS)),
        allowNull: false,
        defaultValue: DELIVERY_ASSIGNMENT_STATUS.ASSIGNED,
      },
      failureReason: { type: DataTypes.STRING(500), allowNull: true },
      // Legally required handoff check: the partner must confirm the recipient
      // is of legal age before the order can be marked DELIVERED.
      recipientVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      recipientVerificationNotes: { type: DataTypes.STRING(500), allowNull: true },
      recipientDocumentType: { type: DataTypes.STRING(50), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('delivery_assignments')
  );

  DeliveryAssignment.associate = (models) => {
    DeliveryAssignment.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    DeliveryAssignment.belongsTo(models.DeliveryPartner, {
      foreignKey: 'deliveryPartnerId',
      as: 'partner',
    });
    DeliveryAssignment.hasMany(models.DeliveryTracking, {
      foreignKey: 'deliveryAssignmentId',
      as: 'tracking',
    });
    DeliveryAssignment.hasMany(models.DeliveryStatusHistory, {
      foreignKey: 'deliveryAssignmentId',
      as: 'statusHistory',
    });
  };

  return DeliveryAssignment;
};
