'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');

module.exports = (sequelize, DataTypes) => {
  const NotificationAction = sequelize.define(
    'NotificationAction',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      notificationId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      actionLabel: { type: DataTypes.STRING(100), allowNull: false },
      actionUrl: { type: DataTypes.STRING(500), allowNull: false },
      ...auditAttributes(DataTypes),
    },
    auditOptions('notification_actions')
  );

  NotificationAction.associate = (models) => {
    NotificationAction.belongsTo(models.Notification, {
      foreignKey: 'notificationId',
      as: 'notification',
    });
  };

  return NotificationAction;
};
