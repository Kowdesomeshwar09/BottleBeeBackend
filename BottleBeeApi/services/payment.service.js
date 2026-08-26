'use strict';

const config = require('../config');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const { PAYMENT_PROVIDER } = require('../config/constants');

/**
 * Payment provider resolution — SHARED SERVICE.
 *
 * Payment orchestration lives in `payment.controller.js`. What stays here is the
 * choice of provider and the contract it must satisfy, so the controller never
 * names a vendor: swapping Razorpay for Stripe is a config change and one new
 * file, not a rewrite of the payment flow.
 *
 * Every provider implements:
 *   createOrder({ amount, currency, receipt, notes })
 *   verifyPaymentSignature({ providerOrderId, providerPaymentId, signature })
 *   verifyWebhookSignature(rawBody, signature)
 *   fetchPayment(providerPaymentId)
 *   refund({ providerPaymentId, amount, notes })
 */

let cached = null;

/** The configured provider, loaded once. */
function getProvider() {
  if (cached) return cached;

  switch (config.payment.provider) {
    case PAYMENT_PROVIDER.RAZORPAY:
      // eslint-disable-next-line global-require
      cached = require('./paymentProviders/razorpay.provider');
      break;

    case 'MOCK':
      // eslint-disable-next-line global-require
      cached = require('./paymentProviders/mock.provider');
      break;

    default:
      throw new Error(
        `Unsupported PAYMENT_PROVIDER "${config.payment.provider}". Use RAZORPAY or MOCK.`
      );
  }

  logger.info('Payment provider: %s', cached.name);
  return cached;
}

/**
 * The provider enum value to store on a payment row.
 *
 * The mock is a development stand-in rather than a real rail, so its payments
 * are recorded as RAZORPAY — the rail they stand in for — keeping the enum
 * meaningful and avoiding a fake value leaking into reporting.
 */
function providerEnumValue() {
  const provider = getProvider();
  return provider.name === 'MOCK' ? PAYMENT_PROVIDER.RAZORPAY : provider.name;
}

/** True when online capture applies; CASH settles at the door instead. */
function isOnlineMethod(method) {
  return method !== PAYMENT_PROVIDER.CASH;
}

/** Throws unless the client handshake genuinely came from the provider. */
function assertPaymentSignature({ providerOrderId, providerPaymentId, signature }) {
  const provider = getProvider();

  if (!provider.verifyPaymentSignature({ providerOrderId, providerPaymentId, signature })) {
    logger.warn(
      'Rejected payment confirmation with a bad signature for provider order %s',
      providerOrderId
    );
    throw AppError.unauthorized('Payment verification failed. This payment was not confirmed.');
  }

  return true;
}

module.exports = {
  getProvider,
  providerEnumValue,
  isOnlineMethod,
  assertPaymentSignature,
};
