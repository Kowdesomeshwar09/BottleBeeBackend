'use strict';

const {
  primaryKey, fk, money, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const { CART_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'carts',
      {
        id: primaryKey(Sequelize),
        customer_id: fk(Sequelize, { table: 'customer_profiles', onDelete: 'CASCADE' }),
        // Set on first add-to-cart; the cart is single-vendor by design.
        vendor_id: fk(Sequelize, { table: 'vendors', allowNull: true, onDelete: 'SET NULL' }),
        coupon_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        coupon_code: { type: DataTypes.STRING(80), allowNull: true },
        status: {
          type: DataTypes.ENUM(...Object.values(CART_STATUS)),
          allowNull: false,
          defaultValue: CART_STATUS.ACTIVE,
        },
        subtotal: money(Sequelize, { defaultValue: 0 }),
        discount_total: money(Sequelize, { defaultValue: 0 }),
        tax_total: money(Sequelize, { defaultValue: 0 }),
        delivery_fee: money(Sequelize, { defaultValue: 0 }),
        grand_total: money(Sequelize, { defaultValue: 0 }),
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('carts', ['customer_id', 'status'], {
      name: 'idx_carts_customer_status',
    });
    await applyAuditBehaviour(queryInterface, 'carts');

    await queryInterface.createTable(
      'cart_items',
      {
        id: primaryKey(Sequelize),
        cart_id: fk(Sequelize, { table: 'carts', onDelete: 'CASCADE' }),
        product_variant_id: fk(Sequelize, { table: 'product_variants', onDelete: 'RESTRICT' }),
        quantity: { type: DataTypes.INTEGER, allowNull: false },
        unit_price: money(Sequelize),
        line_total: money(Sequelize),
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('cart_items', ['cart_id', 'product_variant_id'], {
      unique: true,
      name: 'uq_cart_variant',
    });
    await applyAuditBehaviour(queryInterface, 'cart_items');
    await addCheck(queryInterface, 'cart_items', 'chk_cart_item_quantity_positive', 'quantity > 0');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cart_items');
    await queryInterface.dropTable('carts');
  },
};
