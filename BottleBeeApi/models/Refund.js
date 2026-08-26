'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');
const { REFUND_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Refund = sequelize.define(
    'Refund',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      orderId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      paymentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      amount: money(DataTypes),
      reason: { type: DataTypes.STRING(500), allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(REFUND_STATUS)),
        allowNull: false,
        defaultValue: REFUND_STATUS.REQUESTED,
      },
      providerRefundId: { type: DataTypes.STRING(255), allowNull: true },
      requestedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      reviewedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
      processedAt: { type: DataTypes.DATE, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('refunds')
  );

  Refund.associate = (models) => {
    Refund.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    Refund.belongsTo(models.Payment, { foreignKey: 'paymentId', as: 'payment' });
    Refund.belongsTo(models.User, { foreignKey: 'reviewedBy', as: 'reviewer' });
  };

  return Refund;
};
