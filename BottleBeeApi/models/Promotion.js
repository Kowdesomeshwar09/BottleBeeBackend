'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { PROMOTION_TARGET_TYPE, COUPON_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Promotion = sequelize.define(
    'Promotion',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(150), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      bannerUrl: { type: DataTypes.STRING(500), allowNull: true },
      targetType: {
        type: DataTypes.ENUM(...Object.values(PROMOTION_TARGET_TYPE)),
        allowNull: false,
        defaultValue: PROMOTION_TARGET_TYPE.ALL,
      },
      // Polymorphic: resolved against categories / products / vendors by
      // targetType, so there is deliberately no foreign key.
      targetId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      startsAt: { type: DataTypes.DATE, allowNull: false },
      endsAt: { type: DataTypes.DATE, allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(COUPON_STATUS)),
        allowNull: false,
        defaultValue: COUPON_STATUS.ACTIVE,
      },
      ...auditAttributes(DataTypes),
    },
    auditOptions('promotions')
  );

  return Promotion;
};
