'use strict';

const { primaryKey, fk, tableOptions } = require('../utils/migrationColumns');

/**
 * audit_logs is the one table without the standard audit block: it is
 * append-only, so `updated_*`, `deleted_*` and `is_active` would be
 * meaningless. Only `created_at` is kept.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'audit_logs',
      {
        id: primaryKey(Sequelize),
        actor_user_id: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        action: { type: DataTypes.STRING(120), allowNull: false },
        entity_type: { type: DataTypes.STRING(120), allowNull: false },
        entity_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        old_values: { type: DataTypes.JSON, allowNull: true },
        new_values: { type: DataTypes.JSON, allowNull: true },
        ip_address: { type: DataTypes.STRING(80), allowNull: true },
        user_agent: { type: DataTypes.STRING(500), allowNull: true },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      tableOptions
    );

    await queryInterface.addIndex('audit_logs', ['actor_user_id'], { name: 'idx_audit_actor' });
    await queryInterface.addIndex('audit_logs', ['entity_type', 'entity_id'], { name: 'idx_audit_entity' });
    await queryInterface.addIndex('audit_logs', ['action'], { name: 'idx_audit_action' });
    await queryInterface.addIndex('audit_logs', ['created_at'], { name: 'idx_audit_created' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_logs');
  },
};
