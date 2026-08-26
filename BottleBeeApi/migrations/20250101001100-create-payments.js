'use strict';

const {
  primaryKey, fk, money, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const {
  PAYMENT_PROVIDER, PAYMENT_STATUS, PAYMENT_TRANSACTION_TYPE, REFUND_STATUS,
} = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'payments',
      {
        id: primaryKey(Sequelize),
        order_id: fk(Sequelize, { table: 'orders', onDelete: 'CASCADE' }),
        payment_provider: {
          type: DataTypes.ENUM(...Object.values(PAYMENT_PROVIDER)),
          allowNull: false,
        },
        provider_order_id: { type: DataTypes.STRING(255), allowNull: true },
        provider_payment_id: { type: DataTypes.STRING(255), allowNull: true },
        amount: money(Sequelize),
        amount_refunded: money(Sequelize, { defaultValue: 0 }),
        currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
        status: {
          type: DataTypes.ENUM(...Object.values(PAYMENT_STATUS)),
          allowNull: false,
          defaultValue: PAYMENT_STATUS.PENDING,
        },
        paid_at: { type: DataTypes.DATE, allowNull: true },
        failure_reason: { type: DataTypes.STRING(500), allowNull: true },
        raw_response: { type: DataTypes.JSON, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    // provider_payment_id is NULL until the provider confirms; MySQL permits
    // multiple NULLs in a UNIQUE index, so pending rows do not collide.
    await queryInterface.addIndex('payments', ['provider_payment_id'], {
      unique: true,
      name: 'uq_payment_provider_payment',
    });
    await queryInterface.addIndex('payments', ['order_id'], { name: 'idx_payments_order' });
    await queryInterface.addIndex('payments', ['provider_order_id'], {
      name: 'idx_payments_provider_order',
    });
    await queryInterface.addIndex('payments', ['status'], { name: 'idx_payments_status' });
    await applyAuditBehaviour(queryInterface, 'payments');
    await addCheck(queryInterface, 'payments', 'chk_payments_amount_positive', 'amount >= 0');
    await addCheck(
      queryInterface,
      'payments',
      'chk_payments_refund_within_amount',
      'amount_refunded >= 0 AND amount_refunded <= amount'
    );

    await queryInterface.createTable(
      'payment_transactions',
      {
        id: primaryKey(Sequelize),
        payment_id: fk(Sequelize, { table: 'payments', onDelete: 'CASCADE' }),
        transaction_type: {
          type: DataTypes.ENUM(...Object.values(PAYMENT_TRANSACTION_TYPE)),
          allowNull: false,
        },
        provider_reference: { type: DataTypes.STRING(255), allowNull: true },
        amount: money(Sequelize),
        status: { type: DataTypes.STRING(80), allowNull: false },
        payload: { type: DataTypes.JSON, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('payment_transactions', ['payment_id'], {
      name: 'idx_payment_tx_payment',
    });
    // Webhook idempotency: the same provider event must never be applied twice.
    await queryInterface.addIndex('payment_transactions', ['transaction_type', 'provider_reference'], {
      unique: true,
      name: 'uq_payment_tx_provider_reference',
    });
    await applyAuditBehaviour(queryInterface, 'payment_transactions');

    await queryInterface.createTable(
      'refunds',
      {
        id: primaryKey(Sequelize),
        order_id: fk(Sequelize, { table: 'orders', onDelete: 'CASCADE' }),
        payment_id: fk(Sequelize, { table: 'payments', onDelete: 'CASCADE' }),
        amount: money(Sequelize),
        reason: { type: DataTypes.STRING(500), allowNull: false },
        status: {
          type: DataTypes.ENUM(...Object.values(REFUND_STATUS)),
          allowNull: false,
          defaultValue: REFUND_STATUS.REQUESTED,
        },
        provider_refund_id: { type: DataTypes.STRING(255), allowNull: true },
        requested_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        reviewed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        reviewed_at: { type: DataTypes.DATE, allowNull: true },
        rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
        processed_at: { type: DataTypes.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('refunds', ['order_id'], { name: 'idx_refunds_order' });
    await queryInterface.addIndex('refunds', ['payment_id'], { name: 'idx_refunds_payment' });
    await queryInterface.addIndex('refunds', ['status'], { name: 'idx_refunds_status' });
    await applyAuditBehaviour(queryInterface, 'refunds');
    await addCheck(queryInterface, 'refunds', 'chk_refunds_amount_positive', 'amount > 0');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('refunds');
    await queryInterface.dropTable('payment_transactions');
    await queryInterface.dropTable('payments');
  },
};
