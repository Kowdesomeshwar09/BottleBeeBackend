'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { GENDER } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const CustomerProfile = sequelize.define(
    'CustomerProfile',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      legalFirstName: { type: DataTypes.STRING(100), allowNull: false },
      legalLastName: { type: DataTypes.STRING(100), allowNull: false },
      dateOfBirth: { type: DataTypes.DATEONLY, allowNull: false },
      gender: { type: DataTypes.ENUM(...Object.values(GENDER)), allowNull: true },
      defaultAddressId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      marketingOptIn: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // Denormalised from the approved age_verifications row. Checkout reads
      // this flag, and only the verification review service may write it.
      ageVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ageVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('customer_profiles')
  );

  CustomerProfile.associate = (models) => {
    CustomerProfile.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    CustomerProfile.hasMany(models.CustomerAddress, { foreignKey: 'customerId', as: 'addresses' });
    CustomerProfile.belongsTo(models.CustomerAddress, {
      foreignKey: 'defaultAddressId',
      as: 'defaultAddress',
    });
    CustomerProfile.hasMany(models.Cart, { foreignKey: 'customerId', as: 'carts' });
    CustomerProfile.hasMany(models.Order, { foreignKey: 'customerId', as: 'orders' });
  };

  CustomerProfile.prototype.legalName = function legalName() {
    return [this.legalFirstName, this.legalLastName].filter(Boolean).join(' ');
  };

  return CustomerProfile;
};
