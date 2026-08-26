'use strict';

const {
  primaryKey, fk, money, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const { ORDER_STATUS, ORDER_PAYMENT_STATUS, ORDER_DELIVERY_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'orders',
      {
        id: primaryKey(Sequelize),
        order_number: { type: DataTypes.STRING(50), allowNull: false },
        customer_id: fk(Sequelize, { table: 'customer_profiles', onDelete: 'RESTRICT' }),
        vendor_id: fk(Sequelize, { table: 'vendors', onDelete: 'RESTRICT' }),
        delivery_address_id: fk(Sequelize, { table: 'customer_addresses', onDelete: 'RESTRICT' }),
        cart_id: fk(Sequelize, { table: 'carts', allowNull: true, onDelete: 'SET NULL' }),
        status: {
          type: DataTypes.ENUM(...Object.values(ORDER_STATUS)),
          allowNull: false,
          defaultValue: ORDER_STATUS.PLACED,
        },
        subtotal: money(Sequelize),
        discount_total: money(Sequelize, { defaultValue: 0 }),
        tax_total: money(Sequelize, { defaultValue: 0 }),
        delivery_fee: money(Sequelize, { defaultValue: 0 }),
        grand_total: money(Sequelize),
        payment_status: {
          type: DataTypes.ENUM(...Object.values(ORDER_PAYMENT_STATUS)),
          allowNull: false,
          defaultValue: ORDER_PAYMENT_STATUS.PENDING,
        },
        delivery_status: {
          type: DataTypes.ENUM(...Object.values(ORDER_DELIVERY_STATUS)),
          allowNull: false,
          defaultValue: ORDER_DELIVERY_STATUS.PENDING,
        },
        // Address is snapshotted so an edited or deleted address never rewrites
        // history, and the region drives the compliance rules that were applied.
        delivery_address_snapshot: { type: DataTypes.JSON, allowNull: true },
        region_code: { type: DataTypes.STRING(50), allowNull: true },
        customer_notes: { type: DataTypes.STRING(500), allowNull: true },
        cancellation_reason: { type: DataTypes.STRING(500), allowNull: true },
        cancelled_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        cancelled_at: { type: DataTypes.DATE, allowNull: true },
        confirmed_at: { type: DataTypes.DATE, allowNull: true },
        delivered_at: { type: DataTypes.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('orders', ['order_number'], {
      unique: true,
      name: 'uq_orders_order_number',
    });
    await queryInterface.addIndex('orders', ['customer_id'], { name: 'idx_orders_customer' });
    await queryInterface.addIndex('orders', ['vendor_id', 'status'], { name: 'idx_orders_vendor_status' });
    await queryInterface.addIndex('orders', ['created_at'], { name: 'idx_orders_created' });
    await queryInterface.addIndex('orders', ['payment_status'], { name: 'idx_orders_payment_status' });
    await queryInterface.addIndex('orders', ['delivery_status'], { name: 'idx_orders_delivery_status' });
    await applyAuditBehaviour(queryInterface, 'orders');
    await addCheck(queryInterface, 'orders', 'chk_orders_totals_non_negative',
      'subtotal >= 0 AND discount_total >= 0 AND tax_total >= 0 AND delivery_fee >= 0 AND grand_total >= 0');

    await queryInterface.createTable(
      'order_items',
      {
        id: primaryKey(Sequelize),
        order_id: fk(Sequelize, { table: 'orders', onDelete: 'CASCADE' }),
        product_id: fk(Sequelize, { table: 'products', onDelete: 'RESTRICT' }),
        product_variant_id: fk(Sequelize, { table: 'product_variants', onDelete: 'RESTRICT' }),
        // Name and label are denormalised on purpose: an invoice must render
        // what the customer bought, not what the catalog says today.
        product_name: { type: DataTypes.STRING(255), allowNull: false },
        variant_label: { type: DataTypes.STRING(120), allowNull: true },
        sku: { type: DataTypes.STRING(120), allowNull: true },
        quantity: { type: DataTypes.INTEGER, allowNull: false },
        unit_price: money(Sequelize),
        tax_amount: money(Sequelize, { defaultValue: 0 }),
        discount_amount: money(Sequelize, { defaultValue: 0 }),
        line_total: money(Sequelize),
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('order_items', ['order_id'], { name: 'idx_order_items_order' });
    await queryInterface.addIndex('order_items', ['product_variant_id'], {
      name: 'idx_order_items_variant',
    });
    await applyAuditBehaviour(queryInterface, 'order_items');
    await addCheck(queryInterface, 'order_items', 'chk_order_item_quantity_positive', 'quantity > 0');

    await queryInterface.createTable(
      'order_status_history',
      {
        id: primaryKey(Sequelize),
        order_id: fk(Sequelize, { table: 'orders', onDelete: 'CASCADE' }),
        from_status: { type: DataTypes.STRING(50), allowNull: true },
        to_status: { type: DataTypes.STRING(50), allowNull: false },
        changed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        note: { type: DataTypes.STRING(500), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('order_status_history', ['order_id'], {
      name: 'idx_order_history_order',
    });
    await applyAuditBehaviour(queryInterface, 'order_status_history');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('order_status_history');
    await queryInterface.dropTable('order_items');
    await queryInterface.dropTable('orders');
  },
};
