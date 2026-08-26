'use strict';

const { auditAttributes, auditOptions, rating } = require('../utils/modelFields');
const { PRODUCT_TYPE, PRODUCT_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Product = sequelize.define(
    'Product',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      categoryId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      brandId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      slug: { type: DataTypes.STRING(280), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      alcoholPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      originCountry: { type: DataTypes.STRING(100), allowNull: true },
      productType: { type: DataTypes.ENUM(...Object.values(PRODUCT_TYPE)), allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(PRODUCT_STATUS)),
        allowNull: false,
        defaultValue: PRODUCT_STATUS.DRAFT,
      },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
      reviewedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      isFeatured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ratingAvg: rating(DataTypes),
      ratingCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ...auditAttributes(DataTypes),
    },
    {
      ...auditOptions('products'),
      scopes: {
        // Everything a public catalog response is allowed to see.
        published: { where: { status: PRODUCT_STATUS.ACTIVE, isActive: true } },
      },
    }
  );

  Product.associate = (models) => {
    Product.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    Product.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });
    Product.belongsTo(models.Brand, { foreignKey: 'brandId', as: 'brand' });
    Product.belongsTo(models.User, { foreignKey: 'reviewedBy', as: 'reviewer' });
    Product.hasMany(models.ProductVariant, { foreignKey: 'productId', as: 'variants' });
    Product.hasMany(models.ProductImage, { foreignKey: 'productId', as: 'images' });
    Product.hasMany(models.Review, { foreignKey: 'productId', as: 'reviews' });
    Product.hasMany(models.OrderItem, { foreignKey: 'productId', as: 'orderItems' });
  };

  Product.prototype.isPurchasable = function isPurchasable() {
    return this.status === PRODUCT_STATUS.ACTIVE && this.isActive;
  };

  return Product;
};
