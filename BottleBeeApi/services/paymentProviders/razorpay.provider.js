'use strict';

const crypto = require('crypto');
const Razorpay = require('razorpay');

const config = require('../../config');
const logger = require('../../config/logger');
const AppError = require('../../utils/AppError');

/**
 * Razorpay payment provider.
 *
 * Razorpay works in the minor currency unit — paise for INR — so every amount
 * crossing this boundary is converted. Getting that wrong by a factor of a
 * hundred is the classic payment bug, so the conversion happens in exactly two
 * places: `toMinor` on the way out, `fromMinor` on the way back.
 *
 * Selected by PAYMENT_PROVIDER=RAZORPAY.
 */

if (!config.payment.keyId || !config.payment.keySecret) {
  throw new Error(
    'PAYMENT_KEY_ID and PAYMENT_KEY_SECRET must be set when PAYMENT_PROVIDER=RAZORPAY.'
  );
}

const client = new Razorpay({
  key_id: config.payment.keyId,
  key_secret: config.payment.keySecret,
});

const toMinor = (amount) => Math.round(Number(amount) * 100);
const fromMinor = (minor) => Number(minor) / 100;

/** Constant-time comparison of two hex digests. */
function digestsMatch(expected, provided) {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(provided));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createOrder({ amount, currency, receipt, notes = {} }) {
  try {
    const order = await client.orders.create({
      amount: toMinor(amount),
      currency: currency || config.payment.currency,
      receipt,
      notes,
    });

    logger.info('[razorpay] created order %s for %s %s', order.id, amount, currency);

    return {
      providerOrderId: order.id,
      amount: fromMinor(order.amount),
      currency: order.currency,
      raw: order,
    };
  } catch (err) {
    logger.error('[razorpay] order creation failed: %s', err.message);
    throw new AppError(
      'Could not start the payment. Please try again.',
      502,
      [{ provider: 'RAZORPAY', detail: err.error?.description || err.message }],
      'PAYMENT_PROVIDER_ERROR'
    );
  }
}

/**
 * Verifies the checkout handshake: HMAC-SHA256 of `order_id|payment_id` keyed
 * with the API secret. This is what proves the client-supplied payment id
 * genuinely belongs to our order rather than being invented.
 */
function verifyPaymentSignature({ providerOrderId, providerPaymentId, signature }) {
  if (!providerOrderId || !providerPaymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', config.payment.keySecret)
    .update(`${providerOrderId}|${providerPaymentId}`)
    .digest('hex');

  return digestsMatch(expected, signature);
}

/**
 * Verifies a webhook body against the webhook secret — a different secret from
 * the API key, and configured separately in the Razorpay dashboard.
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!rawBody || !signature) return false;

  if (!config.payment.webhookSecret) {
    logger.error('[razorpay] PAYMENT_WEBHOOK_SECRET is not set — rejecting webhook');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', config.payment.webhookSecret)
    .update(rawBody)
    .digest('hex');

  return digestsMatch(expected, signature);
}

/** Authoritative payment state, straight from the provider. */
async function fetchPayment(providerPaymentId) {
  try {
    const payment = await client.payments.fetch(providerPaymentId);
    return {
      providerPaymentId: payment.id,
      status: payment.status,
      amount: fromMinor(payment.amount),
      raw: payment,
    };
  } catch (err) {
    logger.error('[razorpay] payment fetch failed for %s: %s', providerPaymentId, err.message);
    throw new AppError(
      'Could not verify the payment with the provider.',
      502,
      [{ provider: 'RAZORPAY', detail: err.error?.description || err.message }],
      'PAYMENT_PROVIDER_ERROR'
    );
  }
}

async function refund({ providerPaymentId, amount, notes = {} }) {
  try {
    const created = await client.payments.refund(providerPaymentId, {
      amount: toMinor(amount),
      notes,
    });

    logger.info('[razorpay] refunded %s of payment %s', amount, providerPaymentId);

    return { providerRefundId: created.id, status: created.status, raw: created };
  } catch (err) {
    logger.error('[razorpay] refund failed for %s: %s', providerPaymentId, err.message);
    throw new AppError(
      'The refund could not be processed by the provider.',
      502,
      [{ provider: 'RAZORPAY', detail: err.error?.description || err.message }],
      'PAYMENT_PROVIDER_ERROR'
    );
  }
}

module.exports = {
  name: 'RAZORPAY',
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchPayment,
  refund,
  toMinor,
  fromMinor,
};
