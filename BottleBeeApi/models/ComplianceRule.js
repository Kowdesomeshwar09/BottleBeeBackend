'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const ComplianceRule = sequelize.define(
    'ComplianceRule',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      regionCode: {
        type: DataTypes.STRING(50),
        allowNull: false,
        set(value) {
          this.setDataValue('regionCode', String(value || '').trim().toUpperCase());
        },
      },
      regionName: { type: DataTypes.STRING(150), allowNull: true },
      minimumAge: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 21 },
      alcoholSaleStartTime: { type: DataTypes.TIME, allowNull: true },
      alcoholSaleEndTime: { type: DataTypes.TIME, allowNull: true },
      dryDay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      maxOrderAmount: money(DataTypes, { allowNull: true }),
      maxQuantityPerOrder: { type: DataTypes.INTEGER, allowNull: true },
      /**
       * Optional extras, all honoured by the compliance service:
       *   dryDates:      ['2026-01-26'] specific dry dates
       *   blockedTypes:  ['LIQUEUR'] product types not sellable in the region
       *   notes:         free text shown to admins
       */
      ruleMetadata: { type: DataTypes.JSON, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('compliance_rules')
  );

  return ComplianceRule;
};
