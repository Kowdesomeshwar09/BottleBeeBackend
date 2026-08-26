'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { VERIFICATION_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const VendorLicense = sequelize.define(
    'VendorLicense',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      vendorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      licenseNumber: { type: DataTypes.STRING(120), allowNull: false },
      licenseType: { type: DataTypes.STRING(100), allowNull: false },
      issuingAuthority: { type: DataTypes.STRING(255), allowNull: false },
      regionCode: { type: DataTypes.STRING(50), allowNull: false },
      validFrom: { type: DataTypes.DATEONLY, allowNull: false },
      validUntil: { type: DataTypes.DATEONLY, allowNull: false },
      documentUrl: { type: DataTypes.STRING(500), allowNull: true },
      status: {
        type: DataTypes.ENUM(...Object.values(VERIFICATION_STATUS)),
        allowNull: false,
        defaultValue: VERIFICATION_STATUS.PENDING,
      },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
      reviewedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('vendor_licenses')
  );

  VendorLicense.associate = (models) => {
    VendorLicense.belongsTo(models.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
    VendorLicense.belongsTo(models.User, { foreignKey: 'reviewedBy', as: 'reviewer' });
  };

  /**
   * A vendor may only sell while it holds an approved licence that is valid
   * today. Checkout calls this for the delivery region.
   */
  VendorLicense.prototype.isValidToday = function isValidToday(reference = new Date()) {
    if (this.status !== VERIFICATION_STATUS.APPROVED) return false;
    const today = reference.toISOString().slice(0, 10);
    return String(this.validFrom) <= today && String(this.validUntil) >= today;
  };

  return VendorLicense;
};
