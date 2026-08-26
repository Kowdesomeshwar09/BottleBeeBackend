'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { ACCOUNT_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      firstName: { type: DataTypes.STRING(100), allowNull: false },
      lastName: { type: DataTypes.STRING(100), allowNull: true },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
        set(value) {
          this.setDataValue('email', String(value || '').trim().toLowerCase());
        },
      },
      phone: { type: DataTypes.STRING(30), allowNull: true },
      passwordHash: { type: DataTypes.STRING(255), allowNull: false },
      profileImageUrl: { type: DataTypes.STRING(500), allowNull: true },
      dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true },
      accountStatus: {
        type: DataTypes.ENUM(...Object.values(ACCOUNT_STATUS)),
        allowNull: false,
        defaultValue: ACCOUNT_STATUS.PENDING,
      },
      emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      phoneVerifiedAt: { type: DataTypes.DATE, allowNull: true },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
      loginAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      lockedUntil: { type: DataTypes.DATE, allowNull: true },
      preferredLanguage: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'en' },
      timezone: { type: DataTypes.STRING(100), allowNull: true },
      ...auditAttributes(DataTypes),
    },
    {
      ...auditOptions('users'),
      defaultScope: {
        // The password hash must never leave the model by accident; the auth
        // service opts back in explicitly with `scope('withPassword')`.
        attributes: { exclude: ['passwordHash'] },
      },
      scopes: {
        withPassword: { attributes: { include: ['passwordHash'] } },
      },
    }
  );

  User.associate = (models) => {
    User.belongsToMany(models.Role, {
      through: models.UserRole,
      foreignKey: 'userId',
      otherKey: 'roleId',
      as: 'roles',
    });
    User.hasMany(models.UserRole, { foreignKey: 'userId', as: 'userRoles' });
    User.hasOne(models.CustomerProfile, { foreignKey: 'userId', as: 'customerProfile' });
    User.hasOne(models.DeliveryPartner, { foreignKey: 'userId', as: 'deliveryPartner' });
    User.hasMany(models.Vendor, { foreignKey: 'ownerUserId', as: 'ownedVendors' });
    User.hasMany(models.VendorUser, { foreignKey: 'userId', as: 'vendorMemberships' });
    User.hasMany(models.RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
    User.hasMany(models.PasswordResetToken, { foreignKey: 'userId', as: 'passwordResetTokens' });
    User.hasMany(models.AgeVerification, { foreignKey: 'userId', as: 'ageVerifications' });
    User.hasMany(models.Notification, { foreignKey: 'userId', as: 'notifications' });
    User.hasMany(models.Review, { foreignKey: 'userId', as: 'reviews' });
    User.hasMany(models.AuditLog, { foreignKey: 'actorUserId', as: 'auditLogs' });
  };

  /** Display name for notifications and order snapshots. */
  User.prototype.fullName = function fullName() {
    return [this.firstName, this.lastName].filter(Boolean).join(' ');
  };

  User.prototype.isLocked = function isLocked() {
    return !!this.lockedUntil && new Date(this.lockedUntil).getTime() > Date.now();
  };

  User.prototype.isLoginable = function isLoginable() {
    return this.accountStatus === ACCOUNT_STATUS.ACTIVE || this.accountStatus === ACCOUNT_STATUS.PENDING;
  };

  return User;
};
