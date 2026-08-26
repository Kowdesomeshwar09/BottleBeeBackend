'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const OrderItem = sequelize.define(
    'OrderItem',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      orderId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      productId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      productVariantId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // Denormalised on purpose: an invoice must show what was bought, not what
      // the catalog says today.
      productName: { type: DataTypes.STRING(255), allowNull: false },
      variantLabel: { type: DataTypes.STRING(120), allowNull: true },
      sku: { type: DataTypes.STRING(120), allowNull: true },
      quantity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
      unitPrice: money(DataTypes),
      taxAmount: money(DataTypes, { defaultValue: 0 }),
      discountAmount: money(DataTypes, { defaultValue: 0 }),
      lineTotal: money(DataTypes),
      ...auditAttributes(DataTypes),
    },
    auditOptions('order_items')
  );

  OrderItem.associate = (models) => {
    OrderItem.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    OrderItem.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
    OrderItem.belongsTo(models.ProductVariant, { foreignKey: 'productVariantId', as: 'variant' });
  };

  return OrderItem;
};
