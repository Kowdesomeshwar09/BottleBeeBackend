'use strict';

const { auditAttributes, auditOptions, coordinate, rating } = require('../utils/modelFields');
const { VEHICLE_TYPE, DELIVERY_PARTNER_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const DeliveryPartner = sequelize.define(
    'DeliveryPartner',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      vehicleType: { type: DataTypes.ENUM(...Object.values(VEHICLE_TYPE)), allowNull: false },
      vehicleNumber: { type: DataTypes.STRING(50), allowNull: false },
      licenseNumber: { type: DataTypes.STRING(100), allowNull: false },
      licenseDocumentUrl: { type: DataTypes.STRING(500), allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(DELIVERY_PARTNER_STATUS)),
        allowNull: false,
        defaultValue: DELIVERY_PARTNER_STATUS.PENDING,
      },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
      reviewedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      currentLatitude: coordinate(DataTypes),
      currentLongitude: coordinate(DataTypes),
      locationUpdatedAt: { type: DataTypes.DATE, allowNull: true },
      ratingAvg: rating(DataTypes),
      ratingCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ...auditAttributes(DataTypes),
    },
    auditOptions('delivery_partners')
  );

  DeliveryPartner.associate = (models) => {
    DeliveryPartner.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    DeliveryPartner.belongsTo(models.User, { foreignKey: 'reviewedBy', as: 'reviewer' });
    DeliveryPartner.hasMany(models.DeliveryAssignment, {
      foreignKey: 'deliveryPartnerId',
      as: 'assignments',
    });
    DeliveryPartner.hasMany(models.Review, { foreignKey: 'deliveryPartnerId', as: 'reviews' });
  };

  DeliveryPartner.prototype.isAssignable = function isAssignable() {
    return this.status === DELIVERY_PARTNER_STATUS.ACTIVE && this.isActive;
  };

  return DeliveryPartner;
};
