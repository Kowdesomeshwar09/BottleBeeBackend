'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');
const { CART_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Cart = sequelize.define(
    'Cart',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      customerId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // Pinned on first add-to-cart. Bottle Bee carts are single-vendor so an
      // order maps to exactly one licensed store.
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      couponId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      couponCode: { type: DataTypes.STRING(80), allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(CART_STATUS)),
        allowNull: false,
        defaultValue: CART_STATUS.ACTIVE,
      },
      // All five totals are recomputed server-side on every mutation; the
      // client never supplies them.
      subtotal: money(DataTypes, { defaultValue: 0 }),
      discountTotal: money(DataTypes, { defaultValue: 0 }),
      taxTotal: money(DataTypes, { defaultValue: 0 }),
      deliveryFee: money(DataTypes, { defaultValue: 0 }),
      grandTotal: money(DataTypes, { defaultValue: 0 }),
      ...auditAttributes(DataTypes),
    },
    auditOptions('carts')
  );

  Cart.associate = (models) => {
    Cart.belongsTo(models.CustomerProfile, { foreignKey: 'customerId', as: 'customer' });
    Cart.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    Cart.belongsTo(models.Coupon, { foreignKey: 'couponId', as: 'coupon' });
    Cart.hasMany(models.CartItem, { foreignKey: 'cartId', as: 'items' });
    Cart.hasOne(models.Order, { foreignKey: 'cartId', as: 'order' });
  };

  return Cart;
};
