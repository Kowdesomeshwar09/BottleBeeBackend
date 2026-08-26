'use strict';

const { auditAttributes, auditOptions } = require('../utils/modelFields');
const { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define(
    'Notification',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      templateCode: { type: DataTypes.STRING(100), allowNull: true },
      channel: { type: DataTypes.ENUM(...Object.values(NOTIFICATION_CHANNEL)), allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      status: {
        type: DataTypes.ENUM(...Object.values(NOTIFICATION_STATUS)),
        allowNull: false,
        defaultValue: NOTIFICATION_STATUS.PENDING,
      },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      readAt: { type: DataTypes.DATE, allowNull: true },
      failureReason: { type: DataTypes.STRING(500), allowNull: true },
      // Deep-link target, e.g. ('Order', 42).
      referenceType: { type: DataTypes.STRING(80), allowNull: true },
      referenceId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      metadata: { type: DataTypes.JSON, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('notifications')
  );

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    Notification.hasMany(models.NotificationAction, {
      foreignKey: 'notificationId',
      as: 'actions',
    });
  };

  return Notification;
};
