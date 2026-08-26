'use strict';

const { primaryKey, fk, auditColumns, tableOptions, applyAuditBehaviour } = require('../utils/migrationColumns');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'refresh_tokens',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        token_hash: { type: DataTypes.STRING(255), allowNull: false },
        device_id: { type: DataTypes.STRING(255), allowNull: true },
        ip_address: { type: DataTypes.STRING(80), allowNull: true },
        user_agent: { type: DataTypes.STRING(500), allowNull: true },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        revoked_at: { type: DataTypes.DATE, allowNull: true },
        // Self-referencing pointer used for refresh-token reuse detection. Left
        // without a FK constraint so revoking a chain never cascades and an
        // ancestor row can be pruned independently.
        replaced_by_token_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('refresh_tokens', ['token_hash'], {
      unique: true,
      name: 'uq_refresh_token_hash',
    });
    await queryInterface.addIndex('refresh_tokens', ['user_id'], { name: 'idx_refresh_user' });
    await queryInterface.addIndex('refresh_tokens', ['expires_at'], { name: 'idx_refresh_expires' });
    await applyAuditBehaviour(queryInterface, 'refresh_tokens');

    await queryInterface.createTable(
      'password_reset_tokens',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        token_hash: { type: DataTypes.STRING(255), allowNull: false },
        expires_at: { type: DataTypes.DATE, allowNull: false },
        used_at: { type: DataTypes.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('password_reset_tokens', ['token_hash'], {
      unique: true,
      name: 'uq_password_reset_token',
    });
    await queryInterface.addIndex('password_reset_tokens', ['user_id'], {
      name: 'idx_password_reset_user',
    });
    await applyAuditBehaviour(queryInterface, 'password_reset_tokens');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('password_reset_tokens');
    await queryInterface.dropTable('refresh_tokens');
  },
};
