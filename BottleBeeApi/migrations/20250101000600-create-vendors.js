'use strict';

const {
  primaryKey, fk, coordinate, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const { VENDOR_STATUS, VENDOR_ROLE, VERIFICATION_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'vendors',
      {
        id: primaryKey(Sequelize),
        business_name: { type: DataTypes.STRING(255), allowNull: false },
        legal_name: { type: DataTypes.STRING(255), allowNull: false },
        owner_user_id: fk(Sequelize, { table: 'users', onDelete: 'RESTRICT' }),
        email: { type: DataTypes.STRING(255), allowNull: false },
        phone: { type: DataTypes.STRING(30), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        logo_url: { type: DataTypes.STRING(500), allowNull: true },
        status: {
          type: DataTypes.ENUM(...Object.values(VENDOR_STATUS)),
          allowNull: false,
          defaultValue: VENDOR_STATUS.PENDING,
        },
        rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
        reviewed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        reviewed_at: { type: DataTypes.DATE, allowNull: true },
        rating_avg: { type: DataTypes.DECIMAL(3, 2), allowNull: false, defaultValue: 0 },
        rating_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        commission_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        // Fulfilment configuration, applied at checkout.
        delivery_radius_km: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
        min_order_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('vendors', ['status'], { name: 'idx_vendors_status' });
    await queryInterface.addIndex('vendors', ['owner_user_id'], { name: 'idx_vendors_owner' });
    await applyAuditBehaviour(queryInterface, 'vendors');
    await addCheck(queryInterface, 'vendors', 'chk_vendors_commission', 'commission_percent BETWEEN 0 AND 100');

    await queryInterface.createTable(
      'vendor_users',
      {
        id: primaryKey(Sequelize),
        vendor_id: fk(Sequelize, { table: 'vendors', onDelete: 'CASCADE' }),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        vendor_role: { type: DataTypes.ENUM(...Object.values(VENDOR_ROLE)), allowNull: false },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('vendor_users', ['vendor_id', 'user_id'], {
      unique: true,
      name: 'uq_vendor_user',
    });
    await queryInterface.addIndex('vendor_users', ['user_id'], { name: 'idx_vendor_users_user' });
    await applyAuditBehaviour(queryInterface, 'vendor_users');

    await queryInterface.createTable(
      'vendor_licenses',
      {
        id: primaryKey(Sequelize),
        vendor_id: fk(Sequelize, { table: 'vendors', onDelete: 'CASCADE' }),
        license_number: { type: DataTypes.STRING(120), allowNull: false },
        license_type: { type: DataTypes.STRING(100), allowNull: false },
        issuing_authority: { type: DataTypes.STRING(255), allowNull: false },
        region_code: { type: DataTypes.STRING(50), allowNull: false },
        valid_from: { type: DataTypes.DATEONLY, allowNull: false },
        valid_until: { type: DataTypes.DATEONLY, allowNull: false },
        document_url: { type: DataTypes.STRING(500), allowNull: true },
        status: {
          type: DataTypes.ENUM(...Object.values(VERIFICATION_STATUS)),
          allowNull: false,
          defaultValue: VERIFICATION_STATUS.PENDING,
        },
        rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
        reviewed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        reviewed_at: { type: DataTypes.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('vendor_licenses', ['license_number'], {
      unique: true,
      name: 'uq_vendor_license_number',
    });
    await queryInterface.addIndex('vendor_licenses', ['vendor_id'], {
      name: 'idx_vendor_license_vendor',
    });
    await queryInterface.addIndex('vendor_licenses', ['status', 'valid_until'], {
      name: 'idx_vendor_license_validity',
    });
    await applyAuditBehaviour(queryInterface, 'vendor_licenses');
    await addCheck(
      queryInterface,
      'vendor_licenses',
      'chk_vendor_license_dates',
      'valid_until >= valid_from'
    );

    await queryInterface.createTable(
      'vendor_addresses',
      {
        id: primaryKey(Sequelize),
        vendor_id: fk(Sequelize, { table: 'vendors', onDelete: 'CASCADE' }),
        address_line1: { type: DataTypes.STRING(255), allowNull: false },
        address_line2: { type: DataTypes.STRING(255), allowNull: true },
        city: { type: DataTypes.STRING(100), allowNull: false },
        state: { type: DataTypes.STRING(100), allowNull: false },
        postal_code: { type: DataTypes.STRING(20), allowNull: false },
        country: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'India' },
        region_code: { type: DataTypes.STRING(50), allowNull: true },
        latitude: coordinate(Sequelize),
        longitude: coordinate(Sequelize),
        is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('vendor_addresses', ['vendor_id'], {
      name: 'idx_vendor_addresses_vendor',
    });
    await applyAuditBehaviour(queryInterface, 'vendor_addresses');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vendor_addresses');
    await queryInterface.dropTable('vendor_licenses');
    await queryInterface.dropTable('vendor_users');
    await queryInterface.dropTable('vendors');
  },
};
