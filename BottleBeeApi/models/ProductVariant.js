'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');
const { VARIANT_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const ProductVariant = sequelize.define(
    'ProductVariant',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      productId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      sku: {
        type: DataTypes.STRING(120),
        allowNull: false,
        set(value) {
          this.setDataValue('sku', String(value || '').trim().toUpperCase());
        },
      },
      sizeMl: { type: DataTypes.INTEGER, allowNull: false },
      packSize: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      mrp: money(DataTypes),
      sellingPrice: money(DataTypes),
      // Applied per line at checkout; kept on the variant so a price change
      // never silently rewrites the tax on historical orders.
      taxPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
      barcode: { type: DataTypes.STRING(120), allowNull: true },
      weightGrams: { type: DataTypes.INTEGER, allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(VARIANT_STATUS)),
        allowNull: false,
        defaultValue: VARIANT_STATUS.ACTIVE,
      },
      ...auditAttributes(DataTypes),
    },
    {
      ...auditOptions('product_variants'),
      validate: {
        mrpNotBelowSellingPrice() {
          if (Number(this.mrp) < Number(this.sellingPrice)) {
            throw new Error('MRP cannot be lower than the selling price');
          }
        },
      },
    }
  );

  ProductVariant.associate = (models) => {
    ProductVariant.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
    ProductVariant.hasOne(models.Inventory, { foreignKey: 'productVariantId', as: 'inventory' });
    ProductVariant.hasMany(models.CartItem, { foreignKey: 'productVariantId', as: 'cartItems' });
    ProductVariant.hasMany(models.OrderItem, { foreignKey: 'productVariantId', as: 'orderItems' });
  };

  /** e.g. "750 ml" or "6 x 330 ml" — snapshotted onto order items. */
  ProductVariant.prototype.label = function label() {
    return this.packSize > 1 ? `${this.packSize} x ${this.sizeMl} ml` : `${this.sizeMl} ml`;
  };

  ProductVariant.prototype.isPurchasable = function isPurchasable() {
    return this.status === VARIANT_STATUS.ACTIVE && this.isActive;
  };

  return ProductVariant;
};
