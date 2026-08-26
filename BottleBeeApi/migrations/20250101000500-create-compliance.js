'use strict';

const {
  primaryKey, fk, money, auditColumns, tableOptions, applyAuditBehaviour,
} = require('../utils/migrationColumns');
const { DOCUMENT_TYPE, VERIFICATION_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'age_verifications',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        document_type: { type: DataTypes.ENUM(...Object.values(DOCUMENT_TYPE)), allowNull: false },
        // Only a keyed hash of the document number is stored, never the number.
        document_number_hash: { type: DataTypes.STRING(255), allowNull: true },
        document_front_url: { type: DataTypes.STRING(500), allowNull: true },
        document_back_url: { type: DataTypes.STRING(500), allowNull: true },
        selfie_url: { type: DataTypes.STRING(500), allowNull: true },
        date_of_birth: { type: DataTypes.DATEONLY, allowNull: false },
        status: {
          type: DataTypes.ENUM(...Object.values(VERIFICATION_STATUS)),
          allowNull: false,
          defaultValue: VERIFICATION_STATUS.PENDING,
        },
        reviewed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        reviewed_at: { type: DataTypes.DATE, allowNull: true },
        rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
        expires_at: { type: DataTypes.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('age_verifications', ['user_id', 'status'], {
      name: 'idx_age_user_status',
    });
    await applyAuditBehaviour(queryInterface, 'age_verifications');

    await queryInterface.createTable(
      'compliance_rules',
      {
        id: primaryKey(Sequelize),
        region_code: { type: DataTypes.STRING(50), allowNull: false },
        region_name: { type: DataTypes.STRING(150), allowNull: true },
        minimum_age: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 21 },
        alcohol_sale_start_time: { type: DataTypes.TIME, allowNull: true },
        alcohol_sale_end_time: { type: DataTypes.TIME, allowNull: true },
        dry_day: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        max_order_amount: money(Sequelize, { allowNull: true }),
        max_quantity_per_order: { type: DataTypes.INTEGER, allowNull: true },
        // Free-form extras: dry-date lists, per-product-type caps, notes.
        rule_metadata: { type: DataTypes.JSON, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('compliance_rules', ['region_code'], {
      unique: true,
      name: 'uq_compliance_region',
    });
    await applyAuditBehaviour(queryInterface, 'compliance_rules');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('compliance_rules');
    await queryInterface.dropTable('age_verifications');
  },
};
