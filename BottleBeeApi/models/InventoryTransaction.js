'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { INVENTORY_TRANSACTION_TYPE, INVENTORY_REFERENCE_TYPE } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const InventoryTransaction = sequelize.define(
    'InventoryTransaction',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      inventoryId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      transactionType: {
        type: DataTypes.ENUM(...Object.values(INVENTORY_TRANSACTION_TYPE)),
        allowNull: false,
      },
      quantity: { type: DataTypes.INTEGER, allowNull: false },
      // Post-movement balances, so the ledger can be audited without replaying
      // every prior row.
      quantityAfter: { type: DataTypes.INTEGER, allowNull: true },
      reservedAfter: { type: DataTypes.INTEGER, allowNull: true },
      referenceType: {
        type: DataTypes.ENUM(...Object.values(INVENTORY_REFERENCE_TYPE)),
        allowNull: false,
      },
      referenceId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      notes: { type: DataTypes.STRING(500), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('inventory_transactions')
  );

  InventoryTransaction.associate = (models) => {
    InventoryTransaction.belongsTo(models.Inventory, { foreignKey: 'inventoryId', as: 'inventory' });
  };

  return InventoryTransaction;
};
