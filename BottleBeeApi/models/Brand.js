'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const Brand = sequelize.define(
    'Brand',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      slug: { type: DataTypes.STRING(180), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      logoUrl: { type: DataTypes.STRING(500), allowNull: true },
      countryOfOrigin: { type: DataTypes.STRING(100), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('brands')
  );

  Brand.associate = (models) => {
    Brand.hasMany(models.Product, { foreignKey: 'brandId', as: 'products' });
  };

  return Brand;
};
