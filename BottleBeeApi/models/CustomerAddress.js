'use strict';

const { auditAttributes, auditOptions, coordinate } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const CustomerAddress = sequelize.define(
    'CustomerAddress',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      customerId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      label: { type: DataTypes.STRING(80), allowNull: true },
      recipientName: { type: DataTypes.STRING(150), allowNull: false },
      phone: { type: DataTypes.STRING(30), allowNull: false },
      addressLine1: { type: DataTypes.STRING(255), allowNull: false },
      addressLine2: { type: DataTypes.STRING(255), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: false },
      state: { type: DataTypes.STRING(100), allowNull: false },
      postalCode: { type: DataTypes.STRING(20), allowNull: false },
      country: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'India' },
      // Resolves which compliance_rules row applies to a delivery here.
      regionCode: { type: DataTypes.STRING(50), allowNull: true },
      latitude: coordinate(DataTypes),
      longitude: coordinate(DataTypes),
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      deliveryInstructions: { type: DataTypes.STRING(500), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('customer_addresses')
  );

  CustomerAddress.associate = (models) => {
    CustomerAddress.belongsTo(models.CustomerProfile, { foreignKey: 'customerId', as: 'customer' });
    CustomerAddress.hasMany(models.Order, { foreignKey: 'deliveryAddressId', as: 'orders' });
  };

  /** Flat snapshot stored on the order so history survives address edits. */
  CustomerAddress.prototype.toSnapshot = function toSnapshot() {
    return {
      recipientName: this.recipientName,
      phone: this.phone,
      addressLine1: this.addressLine1,
      addressLine2: this.addressLine2,
      city: this.city,
      state: this.state,
      postalCode: this.postalCode,
      country: this.country,
      regionCode: this.regionCode,
      latitude: this.latitude,
      longitude: this.longitude,
      deliveryInstructions: this.deliveryInstructions,
    };
  };

  return CustomerAddress;
};
