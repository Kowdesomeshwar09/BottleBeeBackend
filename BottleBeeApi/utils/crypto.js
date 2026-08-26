'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const config = require('../config');

/** Hash a user password. */
async function hashPassword(plain) {
  return bcrypt.hash(plain, config.security.bcryptSaltRounds);
}

/** Constant-time password comparison. */
async function comparePassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/** Opaque, high-entropy token handed to the client (refresh / password reset). */
function generateOpaqueToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Deterministic SHA-256 used for tokens we must look up by value.
 * bcrypt cannot be used here because we need an indexed equality lookup, and
 * the tokens are already 384 bits of CSPRNG entropy so a salt adds nothing.
 */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * One-way hash for identity document numbers. Keyed with the refresh secret so
 * a database leak alone cannot be brute-forced against the (small) space of
 * valid Aadhaar/PAN formats.
 */
function hashDocumentNumber(documentNumber) {
  if (!documentNumber) return null;
  return crypto
    .createHmac('sha256', config.jwt.refreshSecret)
    .update(String(documentNumber).replace(/\s+/g, '').toUpperCase())
    .digest('hex');
}

/** Timing-safe comparison of two hex digests. */
function safeEqual(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  hashPassword,
  comparePassword,
  generateOpaqueToken,
  sha256,
  hashDocumentNumber,
  safeEqual,
};
