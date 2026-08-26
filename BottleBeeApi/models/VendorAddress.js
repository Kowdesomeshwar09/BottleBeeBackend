'use strict';

const { auditAttributes, auditOptions, coordinate } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const VendorAddress = sequelize.define(
    'VendorAddress',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      addressLine1: { type: DataTypes.STRING(255), allowNull: false },
      addressLine2: { type: DataTypes.STRING(255), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: false },
      state: { type: DataTypes.STRING(100), allowNull: false },
      postalCode: { type: DataTypes.STRING(20), allowNull: false },
      country: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'India' },
      regionCode: { type: DataTypes.STRING(50), allowNull: true },
      latitude: coordinate(DataTypes),
      longitude: coordinate(DataTypes),
      isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ...auditAttributes(DataTypes),
    },
    auditOptions('vendor_addresses')
  );

  VendorAddress.associate = (models) => {
    VendorAddress.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
  };

  return VendorAddress;
};
