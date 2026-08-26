'use strict';

const { primaryKey, auditColumns, tableOptions, applyAuditBehaviour } = require('../utils/migrationColumns');
const { ACCOUNT_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'users',
      {
        id: primaryKey(Sequelize),
        first_name: { type: DataTypes.STRING(100), allowNull: false },
        last_name: { type: DataTypes.STRING(100), allowNull: true },
        email: { type: DataTypes.STRING(255), allowNull: false },
        phone: { type: DataTypes.STRING(30), allowNull: true },
        password_hash: { type: DataTypes.STRING(255), allowNull: false },
        profile_image_url: { type: DataTypes.STRING(500), allowNull: true },
        date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },
        account_status: {
          type: DataTypes.ENUM(...Object.values(ACCOUNT_STATUS)),
          allowNull: false,
          defaultValue: ACCOUNT_STATUS.PENDING,
        },
        email_verified_at: { type: DataTypes.DATE, allowNull: true },
        phone_verified_at: { type: DataTypes.DATE, allowNull: true },
        last_login_at: { type: DataTypes.DATE, allowNull: true },
        login_attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        locked_until: { type: DataTypes.DATE, allowNull: true },
        preferred_language: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'en' },
        timezone: { type: DataTypes.STRING(100), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );

    await queryInterface.addIndex('users', ['email'], { unique: true, name: 'uq_users_email' });
    await queryInterface.addIndex('users', ['phone'], { unique: true, name: 'uq_users_phone' });
    await queryInterface.addIndex('users', ['account_status'], { name: 'idx_users_status' });
    await applyAuditBehaviour(queryInterface, 'users');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
