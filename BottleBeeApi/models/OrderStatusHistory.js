'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const OrderStatusHistory = sequelize.define(
    'OrderStatusHistory',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      orderId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      fromStatus: { type: DataTypes.STRING(50), allowNull: true },
      toStatus: { type: DataTypes.STRING(50), allowNull: false },
      changedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      note: { type: DataTypes.STRING(500), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('order_status_history')
  );

  OrderStatusHistory.associate = (models) => {
    OrderStatusHistory.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    OrderStatusHistory.belongsTo(models.User, { foreignKey: 'changedBy', as: 'actor' });
  };

  return OrderStatusHistory;
};
