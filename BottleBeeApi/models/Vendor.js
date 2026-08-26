'use strict';

const { auditAttributes, auditOptions, money, rating } = require('../utils/modelFields');
const { VENDOR_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define(
    'Vendor',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      businessName: { type: DataTypes.STRING(255), allowNull: false },
      legalName: { type: DataTypes.STRING(255), allowNull: false },
      ownerUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false, validate: { isEmail: true } },
      phone: { type: DataTypes.STRING(30), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      logoUrl: { type: DataTypes.STRING(500), allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(VENDOR_STATUS)),
        allowNull: false,
        defaultValue: VENDOR_STATUS.PENDING,
      },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
      reviewedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      ratingAvg: rating(DataTypes),
      ratingCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      commissionPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
      deliveryRadiusKm: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
      minOrderAmount: money(DataTypes, { allowNull: true }),
      ...auditAttributes(DataTypes),
    },
    auditOptions('vendors')
  );

  Vendor.associate = (models) => {
    Vendor.belongsTo(models.User, { foreignKey: 'ownerUserId', as: 'owner' });
    Vendor.belongsTo(models.User, { foreignKey: 'reviewedBy', as: 'reviewer' });
    Vendor.hasMany(models.VendorUser, { foreignKey: 'vendorId', as: 'staff' });
    Vendor.hasMany(models.VendorLicense, { foreignKey: 'vendorId', as: 'licenses' });
    Vendor.hasMany(models.VendorAddress, { foreignKey: 'vendorId', as: 'addresses' });
    Vendor.hasMany(models.Product, { foreignKey: 'vendorId', as: 'products' });
    Vendor.hasMany(models.Inventory, { foreignKey: 'vendorId', as: 'inventory' });
    Vendor.hasMany(models.Order, { foreignKey: 'vendorId', as: 'orders' });
    Vendor.hasMany(models.Review, { foreignKey: 'vendorId', as: 'reviews' });
  };

  Vendor.prototype.isOperational = function isOperational() {
    return this.status === VENDOR_STATUS.APPROVED && this.isActive;
  };

  return Vendor;
};
