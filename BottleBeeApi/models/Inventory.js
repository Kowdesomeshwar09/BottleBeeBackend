'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const Inventory = sequelize.define(
    'Inventory',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      productVariantId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // Sellable stock. Checkout moves units from here into quantityReserved.
      quantityAvailable: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // Held for orders that are placed but not yet delivered or cancelled.
      quantityReserved: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      reorderLevel: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ...auditAttributes(DataTypes),
    },
    auditOptions('inventory')
  );

  Inventory.associate = (models) => {
    Inventory.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    Inventory.belongsTo(models.ProductVariant, { foreignKey: 'productVariantId', as: 'variant' });
    Inventory.hasMany(models.InventoryTransaction, { foreignKey: 'inventoryId', as: 'transactions' });
  };

  Inventory.prototype.isLow = function isLow() {
    return this.quantityAvailable <= this.reorderLevel;
  };

  return Inventory;
};
