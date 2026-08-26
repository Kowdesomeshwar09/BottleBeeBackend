'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const CartItem = sequelize.define(
    'CartItem',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      cartId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      productVariantId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } },
      unitPrice: money(DataTypes),
      lineTotal: money(DataTypes),
      ...auditAttributes(DataTypes),
    },
    auditOptions('cart_items')
  );

  CartItem.associate = (models) => {
    CartItem.belongsTo(models.Cart, { foreignKey: 'cartId', as: 'cart' });
    CartItem.belongsTo(models.ProductVariant, { foreignKey: 'productVariantId', as: 'variant' });
  };

  return CartItem;
};
