'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { REVIEW_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Review = sequelize.define(
    'Review',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      orderId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // Exactly one of these three is set; enforced by a CHECK constraint.
      productId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      deliveryPartnerId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      rating: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
      title: { type: DataTypes.STRING(150), allowNull: true },
      comment: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(REVIEW_STATUS)),
        allowNull: false,
        defaultValue: REVIEW_STATUS.PENDING,
      },
      moderationNote: { type: DataTypes.STRING(500), allowNull: true },
      moderatedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      moderatedAt: { type: DataTypes.DATE, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    {
      ...auditOptions('reviews'),
      scopes: {
        public: { where: { status: REVIEW_STATUS.APPROVED, isActive: true } },
      },
      validate: {
        exactlyOneSubject() {
          const subjects = [this.productId, this.vendorId, this.deliveryPartnerId]
            .filter((v) => v !== null && v !== undefined).length;
          if (subjects !== 1) {
            throw new Error('A review must target exactly one of product, vendor or delivery partner');
          }
        },
      },
    }
  );

  Review.associate = (models) => {
    Review.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Review.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    Review.belongsTo(models.Product, { foreignKey: 'productId', as: 'product' });
    Review.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    Review.belongsTo(models.DeliveryPartner, {
      foreignKey: 'deliveryPartnerId',
      as: 'deliveryPartner',
    });
    Review.belongsTo(models.User, { foreignKey: 'moderatedBy', as: 'moderator' });
  };

  return Review;
};
