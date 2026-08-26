'use strict';

const {
  primaryKey, fk, money, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const { DISCOUNT_TYPE, COUPON_STATUS, PROMOTION_TARGET_TYPE } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'coupons',
      {
        id: primaryKey(Sequelize),
        code: { type: DataTypes.STRING(80), allowNull: false },
        title: { type: DataTypes.STRING(150), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        discount_type: { type: DataTypes.ENUM(...Object.values(DISCOUNT_TYPE)), allowNull: false },
        discount_value: money(Sequelize),
        max_discount_amount: money(Sequelize, { allowNull: true }),
        min_order_amount: money(Sequelize, { allowNull: true }),
        usage_limit: { type: DataTypes.INTEGER, allowNull: true },
        usage_limit_per_user: { type: DataTypes.INTEGER, allowNull: true },
        // Denormalised counter, incremented inside the checkout transaction so
        // a global usage limit cannot be exceeded by concurrent checkouts.
        usage_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        vendor_id: fk(Sequelize, { table: 'vendors', allowNull: true, onDelete: 'CASCADE' }),
        starts_at: { type: DataTypes.DATE, allowNull: false },
        ends_at: { type: DataTypes.DATE, allowNull: false },
        status: {
          type: DataTypes.ENUM(...Object.values(COUPON_STATUS)),
          allowNull: false,
          defaultValue: COUPON_STATUS.ACTIVE,
        },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('coupons', ['code'], { unique: true, name: 'uq_coupons_code' });
    await queryInterface.addIndex('coupons', ['status', 'starts_at', 'ends_at'], {
      name: 'idx_coupons_status_window',
    });
    await applyAuditBehaviour(queryInterface, 'coupons');
    await addCheck(queryInterface, 'coupons', 'chk_coupons_window', 'ends_at > starts_at');
    await addCheck(queryInterface, 'coupons', 'chk_coupons_value_positive', 'discount_value > 0');
    await addCheck(
      queryInterface,
      'coupons',
      'chk_coupons_percentage_bound',
      "discount_type <> 'PERCENTAGE' OR discount_value <= 100"
    );

    await queryInterface.createTable(
      'coupon_usage',
      {
        id: primaryKey(Sequelize),
        coupon_id: fk(Sequelize, { table: 'coupons', onDelete: 'CASCADE' }),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        order_id: fk(Sequelize, { table: 'orders', onDelete: 'CASCADE' }),
        discount_amount: money(Sequelize),
        used_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('coupon_usage', ['coupon_id', 'order_id'], {
      unique: true,
      name: 'uq_coupon_order',
    });
    await queryInterface.addIndex('coupon_usage', ['coupon_id', 'user_id'], {
      name: 'idx_coupon_user',
    });
    await applyAuditBehaviour(queryInterface, 'coupon_usage');

    await queryInterface.createTable(
      'promotions',
      {
        id: primaryKey(Sequelize),
        title: { type: DataTypes.STRING(150), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        banner_url: { type: DataTypes.STRING(500), allowNull: true },
        target_type: {
          type: DataTypes.ENUM(...Object.values(PROMOTION_TARGET_TYPE)),
          allowNull: false,
          defaultValue: PROMOTION_TARGET_TYPE.ALL,
        },
        // Polymorphic pointer resolved by target_type, hence no FK.
        target_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        starts_at: { type: DataTypes.DATE, allowNull: false },
        ends_at: { type: DataTypes.DATE, allowNull: false },
        status: {
          type: DataTypes.ENUM(...Object.values(COUPON_STATUS)),
          allowNull: false,
          defaultValue: COUPON_STATUS.ACTIVE,
        },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('promotions', ['status', 'starts_at', 'ends_at'], {
      name: 'idx_promotions_status_dates',
    });
    await applyAuditBehaviour(queryInterface, 'promotions');
    await addCheck(queryInterface, 'promotions', 'chk_promotions_window', 'ends_at > starts_at');

    // Deferred FK from carts.coupon_id: coupons are created after carts.
    await queryInterface.addConstraint('carts', {
      fields: ['coupon_id'],
      type: 'foreign key',
      name: 'fk_carts_coupon',
      references: { table: 'coupons', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('carts', 'fk_carts_coupon');
    await queryInterface.dropTable('promotions');
    await queryInterface.dropTable('coupon_usage');
    await queryInterface.dropTable('coupons');
  },
};
