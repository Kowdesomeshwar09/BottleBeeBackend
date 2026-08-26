'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { VENDOR_ROLE } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const VendorUser = sequelize.define(
    'VendorUser',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      vendorRole: { type: DataTypes.ENUM(...Object.values(VENDOR_ROLE)), allowNull: false },
      ...auditAttributes(DataTypes),
    },
    auditOptions('vendor_users')
  );

  VendorUser.associate = (models) => {
    VendorUser.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    VendorUser.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return VendorUser;
};
