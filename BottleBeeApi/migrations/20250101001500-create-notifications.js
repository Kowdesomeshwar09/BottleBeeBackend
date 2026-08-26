'use strict';

const {
  primaryKey, fk, auditColumns, tableOptions, applyAuditBehaviour,
} = require('../utils/migrationColumns');
const { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'notification_templates',
      {
        id: primaryKey(Sequelize),
        code: { type: DataTypes.STRING(100), allowNull: false },
        channel: { type: DataTypes.ENUM(...Object.values(NOTIFICATION_CHANNEL)), allowNull: false },
        subject: { type: DataTypes.STRING(255), allowNull: true },
        body: { type: DataTypes.TEXT, allowNull: false },
        // Declared placeholder names, used to validate a render call.
        variables: { type: DataTypes.JSON, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('notification_templates', ['code', 'channel'], {
      unique: true,
      name: 'uq_notification_template',
    });
    await applyAuditBehaviour(queryInterface, 'notification_templates');

    await queryInterface.createTable(
      'notifications',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        template_code: { type: DataTypes.STRING(100), allowNull: true },
        channel: { type: DataTypes.ENUM(...Object.values(NOTIFICATION_CHANNEL)), allowNull: false },
        title: { type: DataTypes.STRING(255), allowNull: true },
        message: { type: DataTypes.TEXT, allowNull: false },
        status: {
          type: DataTypes.ENUM(...Object.values(NOTIFICATION_STATUS)),
          allowNull: false,
          defaultValue: NOTIFICATION_STATUS.PENDING,
        },
        sent_at: { type: DataTypes.DATE, allowNull: true },
        read_at: { type: DataTypes.DATE, allowNull: true },
        failure_reason: { type: DataTypes.STRING(500), allowNull: true },
        reference_type: { type: DataTypes.STRING(80), allowNull: true },
        reference_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        metadata: { type: DataTypes.JSON, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('notifications', ['user_id', 'status'], {
      name: 'idx_notifications_user_status',
    });
    await queryInterface.addIndex('notifications', ['reference_type', 'reference_id'], {
      name: 'idx_notifications_reference',
    });
    await applyAuditBehaviour(queryInterface, 'notifications');

    await queryInterface.createTable(
      'notification_actions',
      {
        id: primaryKey(Sequelize),
        notification_id: fk(Sequelize, { table: 'notifications', onDelete: 'CASCADE' }),
        action_label: { type: DataTypes.STRING(100), allowNull: false },
        action_url: { type: DataTypes.STRING(500), allowNull: false },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('notification_actions', ['notification_id'], {
      name: 'idx_notification_actions_notification',
    });
    await applyAuditBehaviour(queryInterface, 'notification_actions');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notification_actions');
    await queryInterface.dropTable('notifications');
    await queryInterface.dropTable('notification_templates');
  },
};
