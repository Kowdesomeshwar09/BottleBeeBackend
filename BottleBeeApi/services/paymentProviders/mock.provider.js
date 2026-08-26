'use strict';

const crypto = require('crypto');

const config = require('../../config');
const logger = require('../../config/logger');

/**
 * Mock payment provider.
 *
 * Exists so the whole payment path — intent, signature verification, capture,
 * webhook, refund — is exercisable in development and in tests without Razorpay
 * credentials. It is a real implementation of the provider contract, not a stub
 * that returns success unconditionally: signatures are genuine HMACs and a bad
 * one is rejected, so a test that passes here is testing the same logic
 * production runs.
 *
 * Selected by PAYMENT_PROVIDER=MOCK. Refuses to load in production.
 */

if (config.isProduction) {
  throw new Error(
    'The mock payment provider must not be used in production. Set PAYMENT_PROVIDER=RAZORPAY.'
  );
}

/** Falls back to a fixed dev secret so the flow works with an empty .env. */
const secret = () => config.payment.webhookSecret || 'bottlebee-mock-payment-secret';

const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('hex');

const randomId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('hex')}`;

/** Creates a provider-side order. Amount is in the minor unit, as Razorpay expects. */
async function createOrder({ amount, currency, receipt, notes = {} }) {
  const providerOrderId = randomId('mock_order');

  logger.info('[mock payment] created order %s for %s %s', providerOrderId, amount, currency);

  return {
    providerOrderId,
    amount,
    currency,
    raw: {
      id: providerOrderId,
      entity: 'order',
      amount: Math.round(amount * 100),
      amount_paid: 0,
      currency,
      receipt,
      status: 'created',
      notes,
      provider: 'MOCK',
    },
  };
}

/**
 * Verifies the client-side handshake, exactly as Razorpay's checkout does:
 * HMAC over `providerOrderId|providerPaymentId`.
 */
function verifyPaymentSignature({ providerOrderId, providerPaymentId, signature }) {
  if (!providerOrderId || !providerPaymentId || !signature) return false;

  const expected = sign(`${providerOrderId}|${providerPaymentId}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Verifies a webhook body signature. */
function verifyWebhookSignature(rawBody, signature) {
  if (!rawBody || !signature) return false;

  const expected = sign(rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Reports a payment as captured — the mock has no failure state to poll. */
async function fetchPayment(providerPaymentId) {
  return {
    providerPaymentId,
    status: 'captured',
    raw: { id: providerPaymentId, status: 'captured', provider: 'MOCK' },
  };
}

async function refund({ providerPaymentId, amount, notes = {} }) {
  const providerRefundId = randomId('mock_rfnd');

  logger.info('[mock payment] refunded %s of payment %s', amount, providerPaymentId);

  return {
    providerRefundId,
    status: 'processed',
    raw: {
      id: providerRefundId,
      entity: 'refund',
      payment_id: providerPaymentId,
      amount: Math.round(amount * 100),
      status: 'processed',
      notes,
      provider: 'MOCK',
    },
  };
}

/**
 * Test-only helpers. Let a caller produce the signatures a real client would,
 * so an automated test can complete the handshake.
 */
const testing = {
  signPaymentHandshake: (providerOrderId, providerPaymentId) =>
    sign(`${providerOrderId}|${providerPaymentId}`),
  signWebhook: (rawBody) => sign(rawBody),
  newPaymentId: () => randomId('mock_pay'),
};

module.exports = {
  name: 'MOCK',
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchPayment,
  refund,
  testing,
};
