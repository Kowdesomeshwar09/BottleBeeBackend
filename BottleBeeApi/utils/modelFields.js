'use strict';

/**
 * Shared model attribute builders.
 *
 * `createdAt` / `updatedAt` / `deletedAt` are supplied by Sequelize
 * (timestamps + paranoid, both enabled globally in config/database.js). Only the
 * attribution columns and `is_active` need declaring, so they are declared once
 * here and spread into every model.
 *
 * DECIMAL columns come back as JS numbers rather than strings because
 * `dialectOptions.decimalNumbers` is enabled on the connection, so money
 * attributes need no custom getter.
 */

const auditAttributes = (DataTypes) => ({
  createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  updatedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  deletedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
});

/** Standard options for a business table. */
const auditOptions = (tableName) => ({
  tableName,
  timestamps: true,
  paranoid: true,
  underscored: true,
});

/** DECIMAL(10,2) money attribute. */
const money = (DataTypes, { allowNull = false, defaultValue = undefined } = {}) => {
  const attr = { type: DataTypes.DECIMAL(10, 2), allowNull };
  if (defaultValue !== undefined) attr.defaultValue = defaultValue;
  return attr;
};

/** DECIMAL(10,6) coordinate attribute. */
const coordinate = (DataTypes, { allowNull = true } = {}) => ({
  type: DataTypes.DECIMAL(10, 6),
  allowNull,
});

/** DECIMAL(3,2) rating average. */
const rating = (DataTypes) => ({
  type: DataTypes.DECIMAL(3, 2),
  allowNull: false,
  defaultValue: 0,
});

module.exports = { auditAttributes, auditOptions, money, coordinate, rating };
