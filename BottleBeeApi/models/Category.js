'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const Category = sequelize.define(
    'Category',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      parentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      name: { type: DataTypes.STRING(150), allowNull: false },
      slug: { type: DataTypes.STRING(180), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      imageUrl: { type: DataTypes.STRING(500), allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ...auditAttributes(DataTypes),
    },
    auditOptions('categories')
  );

  Category.associate = (models) => {
    Category.belongsTo(models.Category, { foreignKey: 'parentId', as: 'parent' });
    Category.hasMany(models.Category, { foreignKey: 'parentId', as: 'children' });
    Category.hasMany(models.Product, { foreignKey: 'categoryId', as: 'products' });
  };

  return Category;
};
