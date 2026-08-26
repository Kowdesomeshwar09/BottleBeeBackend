'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');
const { PAYMENT_PROVIDER, PAYMENT_STATUS } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    'Payment',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      orderId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      paymentProvider: {
        type: DataTypes.ENUM(...Object.values(PAYMENT_PROVIDER)),
        allowNull: false,
      },
      providerOrderId: { type: DataTypes.STRING(255), allowNull: true },
      providerPaymentId: { type: DataTypes.STRING(255), allowNull: true },
      amount: money(DataTypes),
      amountRefunded: money(DataTypes, { defaultValue: 0 }),
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
      status: {
        type: DataTypes.ENUM(...Object.values(PAYMENT_STATUS)),
        allowNull: false,
        defaultValue: PAYMENT_STATUS.PENDING,
      },
      paidAt: { type: DataTypes.DATE, allowNull: true },
      failureReason: { type: DataTypes.STRING(500), allowNull: true },
      rawResponse: { type: DataTypes.JSON, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    {
      ...auditOptions('payments'),
      defaultScope: {
        // Provider payloads can contain contact details and card metadata; only
        // admin payment views opt in.
        attributes: { exclude: ['rawResponse'] },
      },
      scopes: {
        withRawResponse: { attributes: { include: ['rawResponse'] } },
      },
    }
  );

  Payment.associate = (models) => {
    Payment.belongsTo(models.Order, { foreignKey: 'orderId', as: 'order' });
    Payment.hasMany(models.PaymentTransaction, { foreignKey: 'paymentId', as: 'transactions' });
    Payment.hasMany(models.Refund, { foreignKey: 'paymentId', as: 'refunds' });
  };

  Payment.prototype.refundableAmount = function refundableAmount() {
    return Number(this.amount) - Number(this.amountRefunded || 0);
  };

  return Payment;
};
