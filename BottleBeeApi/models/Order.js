'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');
const { ORDER_STATUS, ORDER_PAYMENT_STATUS, ORDER_DELIVERY_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define(
    'Order',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      orderNumber: { type: DataTypes.STRING(50), allowNull: false },
      customerId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      deliveryAddressId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      cartId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(ORDER_STATUS)),
        allowNull: false,
        defaultValue: ORDER_STATUS.PLACED,
      },
      subtotal: money(DataTypes),
      discountTotal: money(DataTypes, { defaultValue: 0 }),
      taxTotal: money(DataTypes, { defaultValue: 0 }),
      deliveryFee: money(DataTypes, { defaultValue: 0 }),
      grandTotal: money(DataTypes),
      paymentStatus: {
        type: DataTypes.ENUM(...Object.values(ORDER_PAYMENT_STATUS)),
        allowNull: false,
        defaultValue: ORDER_PAYMENT_STATUS.PENDING,
      },
      deliveryStatus: {
        type: DataTypes.ENUM(...Object.values(ORDER_DELIVERY_STATUS)),
        allowNull: false,
        defaultValue: ORDER_DELIVERY_STATUS.PENDING,
      },
      // Frozen copy of the delivery address, and the region whose compliance
      // rules were applied when the order was accepted.
      deliveryAddressSnapshot: { type: DataTypes.JSON, allowNull: true },
      regionCode: { type: DataTypes.STRING(50), allowNull: true },
      customerNotes: { type: DataTypes.STRING(500), allowNull: true },
      cancellationReason: { type: DataTypes.STRING(500), allowNull: true },
      cancelledBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },
      confirmedAt: { type: DataTypes.DATE, allowNull: true },
      deliveredAt: { type: DataTypes.DATE, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('orders')
  );

  Order.associate = (models) => {
    Order.belongsTo(models.CustomerProfile, { foreignKey: 'customerId', as: 'customer' });
    Order.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    Order.belongsTo(models.CustomerAddress, { foreignKey: 'deliveryAddressId', as: 'deliveryAddress' });
    Order.belongsTo(models.Cart, { foreignKey: 'cartId', as: 'cart' });
    Order.hasMany(models.OrderItem, { foreignKey: 'orderId', as: 'items' });
    Order.hasMany(models.OrderStatusHistory, { foreignKey: 'orderId', as: 'statusHistory' });
    Order.hasMany(models.Payment, { foreignKey: 'orderId', as: 'payments' });
    Order.hasMany(models.Refund, { foreignKey: 'orderId', as: 'refunds' });
    Order.hasOne(models.DeliveryAssignment, { foreignKey: 'orderId', as: 'deliveryAssignment' });
    Order.hasMany(models.Review, { foreignKey: 'orderId', as: 'reviews' });
    Order.hasMany(models.CouponUsage, { foreignKey: 'orderId', as: 'couponUsages' });
  };

  return Order;
};
