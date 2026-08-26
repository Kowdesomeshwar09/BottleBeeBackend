'use strict';

const {
  primaryKey, fk, coordinate, auditColumns, tableOptions, applyAuditBehaviour,
} = require('../utils/migrationColumns');
const { GENDER } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'customer_profiles',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        legal_first_name: { type: DataTypes.STRING(100), allowNull: false },
        legal_last_name: { type: DataTypes.STRING(100), allowNull: false },
        date_of_birth: { type: DataTypes.DATEONLY, allowNull: false },
        gender: { type: DataTypes.ENUM(...Object.values(GENDER)), allowNull: true },
        // FK added after customer_addresses exists (circular reference).
        default_address_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        marketing_opt_in: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        age_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        age_verified_at: { type: DataTypes.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('customer_profiles', ['user_id'], {
      unique: true,
      name: 'uq_customer_user',
    });
    await applyAuditBehaviour(queryInterface, 'customer_profiles');

    await queryInterface.createTable(
      'customer_addresses',
      {
        id: primaryKey(Sequelize),
        customer_id: fk(Sequelize, { table: 'customer_profiles', onDelete: 'CASCADE' }),
        label: { type: DataTypes.STRING(80), allowNull: true },
        recipient_name: { type: DataTypes.STRING(150), allowNull: false },
        phone: { type: DataTypes.STRING(30), allowNull: false },
        address_line1: { type: DataTypes.STRING(255), allowNull: false },
        address_line2: { type: DataTypes.STRING(255), allowNull: true },
        city: { type: DataTypes.STRING(100), allowNull: false },
        state: { type: DataTypes.STRING(100), allowNull: false },
        postal_code: { type: DataTypes.STRING(20), allowNull: false },
        country: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'India' },
        // Region the address falls in, used to resolve compliance rules.
        region_code: { type: DataTypes.STRING(50), allowNull: true },
        latitude: coordinate(Sequelize),
        longitude: coordinate(Sequelize),
        is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        delivery_instructions: { type: DataTypes.STRING(500), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('customer_addresses', ['customer_id'], {
      name: 'idx_customer_addresses_customer',
    });
    await queryInterface.addIndex('customer_addresses', ['postal_code'], {
      name: 'idx_customer_addresses_postal',
    });
    await applyAuditBehaviour(queryInterface, 'customer_addresses');

    await queryInterface.addConstraint('customer_profiles', {
      fields: ['default_address_id'],
      type: 'foreign key',
      name: 'fk_customer_profiles_default_address',
      references: { table: 'customer_addresses', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('customer_profiles', 'fk_customer_profiles_default_address');
    await queryInterface.dropTable('customer_addresses');
    await queryInterface.dropTable('customer_profiles');
  },
};
