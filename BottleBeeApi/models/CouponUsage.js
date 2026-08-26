'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const CouponUsage = sequelize.define(
    'CouponUsage',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      couponId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      orderId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      discountAmount: money(DataTypes),
      usedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      ...auditAttributes(DataTypes),
    },
    auditOptions('coupon_usage')
  );

  CouponUsage.associate = (models) => {
    CouponUsage.belongsTo(models.Coupon, { foreignKey: 'couponId', as: 'coupon' });
    CouponUsage.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    CouponUsage.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
  };

  return CouponUsage;
};
