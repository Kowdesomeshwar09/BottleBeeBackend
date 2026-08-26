'use strict';

const {
  primaryKey, fk, coordinate, auditColumns, tableOptions, applyAuditBehaviour,
} = require('../utils/migrationColumns');
const {
  VEHICLE_TYPE, DELIVERY_PARTNER_STATUS, DELIVERY_ASSIGNMENT_STATUS,
} = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'delivery_partners',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        vehicle_type: { type: DataTypes.ENUM(...Object.values(VEHICLE_TYPE)), allowNull: false },
        vehicle_number: { type: DataTypes.STRING(50), allowNull: false },
        license_number: { type: DataTypes.STRING(100), allowNull: false },
        license_document_url: { type: DataTypes.STRING(500), allowNull: true },
        status: {
          type: DataTypes.ENUM(...Object.values(DELIVERY_PARTNER_STATUS)),
          allowNull: false,
          defaultValue: DELIVERY_PARTNER_STATUS.PENDING,
        },
        rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
        reviewed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        reviewed_at: { type: DataTypes.DATE, allowNull: true },
        current_latitude: coordinate(Sequelize),
        current_longitude: coordinate(Sequelize),
        location_updated_at: { type: DataTypes.DATE, allowNull: true },
        rating_avg: { type: DataTypes.DECIMAL(3, 2), allowNull: false, defaultValue: 0 },
        rating_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('delivery_partners', ['user_id'], {
      unique: true,
      name: 'uq_delivery_user',
    });
    await queryInterface.addIndex('delivery_partners', ['status'], {
      name: 'idx_delivery_partners_status',
    });
    await applyAuditBehaviour(queryInterface, 'delivery_partners');

    await queryInterface.createTable(
      'delivery_assignments',
      {
        id: primaryKey(Sequelize),
        order_id: fk(Sequelize, { table: 'orders', onDelete: 'CASCADE' }),
        delivery_partner_id: fk(Sequelize, { table: 'delivery_partners', onDelete: 'RESTRICT' }),
        assigned_at: { type: DataTypes.DATE, allowNull: false },
        accepted_at: { type: DataTypes.DATE, allowNull: true },
        rejected_at: { type: DataTypes.DATE, allowNull: true },
        picked_up_at: { type: DataTypes.DATE, allowNull: true },
        delivered_at: { type: DataTypes.DATE, allowNull: true },
        status: {
          type: DataTypes.ENUM(...Object.values(DELIVERY_ASSIGNMENT_STATUS)),
          allowNull: false,
          defaultValue: DELIVERY_ASSIGNMENT_STATUS.ASSIGNED,
        },
        failure_reason: { type: DataTypes.STRING(500), allowNull: true },
        // Handoff compliance: the partner must confirm the recipient's age and
        // identity before an order can be marked DELIVERED.
        recipient_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        recipient_verification_notes: { type: DataTypes.STRING(500), allowNull: true },
        recipient_document_type: { type: DataTypes.STRING(50), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    // One live assignment per order. A rejected assignment is soft-deleted
    // before a replacement partner is assigned (see delivery service).
    await queryInterface.addIndex('delivery_assignments', ['order_id'], {
      unique: true,
      name: 'uq_delivery_order',
    });
    await queryInterface.addIndex('delivery_assignments', ['delivery_partner_id', 'status'], {
      name: 'idx_delivery_partner_status',
    });
    await applyAuditBehaviour(queryInterface, 'delivery_assignments');

    await queryInterface.createTable(
      'delivery_tracking',
      {
        id: primaryKey(Sequelize),
        delivery_assignment_id: fk(Sequelize, { table: 'delivery_assignments', onDelete: 'CASCADE' }),
        latitude: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
        longitude: { type: DataTypes.DECIMAL(10, 6), allowNull: false },
        recorded_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('delivery_tracking', ['delivery_assignment_id', 'recorded_at'], {
      name: 'idx_tracking_assignment_time',
    });
    await applyAuditBehaviour(queryInterface, 'delivery_tracking');

    await queryInterface.createTable(
      'delivery_status_history',
      {
        id: primaryKey(Sequelize),
        delivery_assignment_id: fk(Sequelize, { table: 'delivery_assignments', onDelete: 'CASCADE' }),
        from_status: { type: DataTypes.STRING(50), allowNull: true },
        to_status: { type: DataTypes.STRING(50), allowNull: false },
        changed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        note: { type: DataTypes.STRING(500), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('delivery_status_history', ['delivery_assignment_id'], {
      name: 'idx_delivery_history_assignment',
    });
    await applyAuditBehaviour(queryInterface, 'delivery_status_history');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('delivery_status_history');
    await queryInterface.dropTable('delivery_tracking');
    await queryInterface.dropTable('delivery_assignments');
    await queryInterface.dropTable('delivery_partners');
  },
};
