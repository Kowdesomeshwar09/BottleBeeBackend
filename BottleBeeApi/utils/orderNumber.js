'use strict';

const crypto = require('crypto');

/**
 * Human-quotable order number: BB-YYMMDD-XXXXXX.
 *
 * The random suffix is drawn from a 32-character alphabet with visually
 * ambiguous characters removed, so a customer can read it over the phone. The
 * `order_number` column is UNIQUE, and the checkout service retries on a
 * duplicate-key collision, which makes this safe without a central sequence.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomSuffix(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function generateOrderNumber(reference = new Date()) {
  const yy = String(reference.getFullYear()).slice(-2);
  const mm = String(reference.getMonth() + 1).padStart(2, '0');
  const dd = String(reference.getDate()).padStart(2, '0');
  return `BB-${yy}${mm}${dd}-${randomSuffix(6)}`;
}

module.exports = { generateOrderNumber, randomSuffix };
