'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');
const { DISCOUNT_TYPE, COUPON_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Coupon = sequelize.define(
    'Coupon',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      code: {
        type: DataTypes.STRING(80),
        allowNull: false,
        set(value) {
          this.setDataValue('code', String(value || '').trim().toUpperCase());
        },
      },
      title: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      discountType: { type: DataTypes.ENUM(...Object.values(DISCOUNT_TYPE)), allowNull: false },
      discountValue: money(DataTypes),
      maxDiscountAmount: money(DataTypes, { allowNull: true }),
      minOrderAmount: money(DataTypes, { allowNull: true }),
      usageLimit: { type: DataTypes.INTEGER, allowNull: true },
      usageLimitPerUser: { type: DataTypes.INTEGER, allowNull: true },
      // Incremented inside the checkout transaction so concurrent checkouts
      // cannot together exceed `usageLimit`.
      usageCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      // Null means the coupon applies platform-wide.
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(COUPON_STATUS)),
        allowNull: false,
        defaultValue: COUPON_STATUS.ACTIVE,
      },
      ...auditAttributes(DataTypes),
    },
    auditOptions('coupons')
  );

  Coupon.associate = (models) => {
    Coupon.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    Coupon.hasMany(models.CouponUsage, { foreignKey: 'couponId', as: 'usages' });
  };

  Coupon.prototype.isWithinWindow = function isWithinWindow(reference = new Date()) {
    const now = reference.getTime();
    return new Date(this.startsAt).getTime() <= now && new Date(this.endsAt).getTime() >= now;
  };

  return Coupon;
};
