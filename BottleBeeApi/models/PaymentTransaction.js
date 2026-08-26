'use strict';

const { auditAttributes, auditOptions, money } = require('../utils/modelFields');
const { PAYMENT_TRANSACTION_TYPE } = require('../config/constants');

module.exports = (sequelize, DataTypes) => {
  const PaymentTransaction = sequelize.define(
    'PaymentTransaction',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      paymentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      transactionType: {
        type: DataTypes.ENUM(...Object.values(PAYMENT_TRANSACTION_TYPE)),
        allowNull: false,
      },
      // Unique per transaction type: this is the webhook idempotency key.
      providerReference: { type: DataTypes.STRING(255), allowNull: true },
      amount: money(DataTypes),
      status: { type: DataTypes.STRING(80), allowNull: false },
      payload: { type: DataTypes.JSON, allowNull: true },
      ...auditAttributes(DataTypes),
    },
    auditOptions('payment_transactions')
  );

  PaymentTransaction.associate = (models) => {
    PaymentTransaction.belongsTo(models.Payment, { foreignKey: 'paymentId', as: 'payment' });
  };

  return PaymentTransaction;
};
