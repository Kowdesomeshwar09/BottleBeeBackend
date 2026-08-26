'use strict';

const {
  primaryKey, fk, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const { REVIEW_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'reviews',
      {
        id: primaryKey(Sequelize),
        user_id: fk(Sequelize, { table: 'users', onDelete: 'CASCADE' }),
        order_id: fk(Sequelize, { table: 'orders', onDelete: 'CASCADE' }),
        product_id: fk(Sequelize, { table: 'products', allowNull: true, onDelete: 'SET NULL' }),
        vendor_id: fk(Sequelize, { table: 'vendors', allowNull: true, onDelete: 'SET NULL' }),
        delivery_partner_id: fk(Sequelize, {
          table: 'delivery_partners', allowNull: true, onDelete: 'SET NULL',
        }),
        rating: { type: DataTypes.INTEGER, allowNull: false },
        title: { type: DataTypes.STRING(150), allowNull: true },
        comment: { type: DataTypes.TEXT, allowNull: true },
        status: {
          type: DataTypes.ENUM(...Object.values(REVIEW_STATUS)),
          allowNull: false,
          defaultValue: REVIEW_STATUS.PENDING,
        },
        moderation_note: { type: DataTypes.STRING(500), allowNull: true },
        moderated_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        moderated_at: { type: DataTypes.DATE, allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('reviews', ['product_id'], { name: 'idx_reviews_product' });
    await queryInterface.addIndex('reviews', ['vendor_id'], { name: 'idx_reviews_vendor' });
    await queryInterface.addIndex('reviews', ['delivery_partner_id'], {
      name: 'idx_reviews_delivery_partner',
    });
    await queryInterface.addIndex('reviews', ['order_id'], { name: 'idx_reviews_order' });
    await queryInterface.addIndex('reviews', ['status'], { name: 'idx_reviews_status' });
    await applyAuditBehaviour(queryInterface, 'reviews');
    await addCheck(queryInterface, 'reviews', 'chk_reviews_rating_range', 'rating BETWEEN 1 AND 5');

    // "Exactly one of product / vendor / delivery partner" cannot be a CHECK
    // constraint here: MySQL refuses a CHECK over a column that a foreign key
    // uses in a referential action, and all three are ON DELETE SET NULL. The
    // rule is enforced by the model-level validator in models/Review.js and by
    // the review service before insert.
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reviews');
  },
};
