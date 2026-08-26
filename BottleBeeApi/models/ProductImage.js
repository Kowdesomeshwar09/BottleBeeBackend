'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const ProductImage = sequelize.define(
    'ProductImage',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      productId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      imageUrl: { type: DataTypes.STRING(500), allowNull: false },
      altText: { type: DataTypes.STRING(255), allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ...auditAttributes(DataTypes),
    },
    auditOptions('product_images')
  );

  ProductImage.associate = (models) => {
    ProductImage.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
  };

  return ProductImage;
};
