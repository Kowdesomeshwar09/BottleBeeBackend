'use strict';

const {
  primaryKey, fk, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const { INVENTORY_TRANSACTION_TYPE, INVENTORY_REFERENCE_TYPE } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'inventory',
      {
        id: primaryKey(Sequelize),
        vendor_id: fk(Sequelize, { table: 'vendors', onDelete: 'CASCADE' }),
        product_variant_id: fk(Sequelize, { table: 'product_variants', onDelete: 'CASCADE' }),
        quantity_available: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        quantity_reserved: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        reorder_level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('inventory', ['vendor_id', 'product_variant_id'], {
      unique: true,
      name: 'uq_inventory_vendor_variant',
    });
    await queryInterface.addIndex('inventory', ['product_variant_id'], {
      name: 'idx_inventory_variant',
    });
    await applyAuditBehaviour(queryInterface, 'inventory');
    await addCheck(queryInterface, 'inventory', 'chk_inventory_available_non_negative', 'quantity_available >= 0');
    await addCheck(queryInterface, 'inventory', 'chk_inventory_reserved_non_negative', 'quantity_reserved >= 0');

    await queryInterface.createTable(
      'inventory_transactions',
      {
        id: primaryKey(Sequelize),
        inventory_id: fk(Sequelize, { table: 'inventory', onDelete: 'CASCADE' }),
        transaction_type: {
          type: DataTypes.ENUM(...Object.values(INVENTORY_TRANSACTION_TYPE)),
          allowNull: false,
        },
        quantity: { type: DataTypes.INTEGER, allowNull: false },
        // Balance after the movement, so history can be audited without replay.
        quantity_after: { type: DataTypes.INTEGER, allowNull: true },
        reserved_after: { type: DataTypes.INTEGER, allowNull: true },
        reference_type: {
          type: DataTypes.ENUM(...Object.values(INVENTORY_REFERENCE_TYPE)),
          allowNull: false,
        },
        reference_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        notes: { type: DataTypes.STRING(500), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('inventory_transactions', ['inventory_id'], {
      name: 'idx_inventory_tx_inventory',
    });
    await queryInterface.addIndex('inventory_transactions', ['reference_type', 'reference_id'], {
      name: 'idx_inventory_tx_reference',
    });
    await applyAuditBehaviour(queryInterface, 'inventory_transactions');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('inventory_transactions');
    await queryInterface.dropTable('inventory');
  },
};
