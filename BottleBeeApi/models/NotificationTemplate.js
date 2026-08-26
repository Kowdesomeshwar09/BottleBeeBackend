'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { NOTIFICATION_CHANNEL } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const NotificationTemplate = sequelize.define(
    'NotificationTemplate',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      code: {
        type: DataTypes.STRING(100),
        allowNull: false,
        set(value) {
          this.setDataValue('code', String(value || '').trim().toUpperCase());
        },
      },
      channel: { type: DataTypes.ENUM(...Object.values(NOTIFICATION_CHANNEL)), allowNull: false },
      subject: { type: DataTypes.STRING(255), allowNull: true },
      // Placeholders use {{variableName}} and are substituted at send time.
      body: { type: DataTypes.TEXT, allowNull: false },
      variables: { type: DataTypes.JSON, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('notification_templates')
  );

  return NotificationTemplate;
};
