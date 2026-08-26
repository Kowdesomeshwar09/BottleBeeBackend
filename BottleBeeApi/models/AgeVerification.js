'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { DOCUMENT_TYPE, VERIFICATION_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const AgeVerification = sequelize.define(
    'AgeVerification',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      documentType: { type: DataTypes.ENUM(...Object.values(DOCUMENT_TYPE)), allowNull: false },
      // Keyed hash only. The raw document number is never persisted.
      documentNumberHash: { type: DataTypes.STRING(255), allowNull: true },
      documentFrontUrl: { type: DataTypes.STRING(500), allowNull: true },
      documentBackUrl: { type: DataTypes.STRING(500), allowNull: true },
      selfieUrl: { type: DataTypes.STRING(500), allowNull: true },
      dateOfBirth: { type: DataTypes.DATEONLY, allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(VERIFICATION_STATUS)),
        allowNull: false,
        defaultValue: VERIFICATION_STATUS.PENDING,
      },
      reviewedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      reviewedAt: { type: DataTypes.DATE, allowNull: true },
      rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    {
      ...auditOptions('age_verifications'),
      defaultScope: {
        // Document hashes and image URLs are sensitive; only the review
        // endpoints opt in via the `withDocuments` scope.
        attributes: { exclude: ['documentNumberHash'] },
      },
      scopes: {
        withDocuments: { attributes: { include: ['documentNumberHash'] } },
      },
    }
  );

  AgeVerification.associate = (models) => {
    AgeVerification.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    AgeVerification.belongsTo(models.User, { foreignKey: 'reviewedBy', as: 'reviewer' });
  };

  AgeVerification.prototype.isCurrentlyValid = function isCurrentlyValid() {
    if (this.status !== VERIFICATION_STATUS.APPROVED) return false;
    if (!this.expiresAt) return true;
    return new Date(this.expiresAt).getTime() > Date.now();
  };

  return AgeVerification;
};
