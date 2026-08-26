'use strict';

/**
 * Money helpers. All monetary columns are DECIMAL(10,2); every computed amount
 * is rounded to 2 decimals at the point of assignment so cart, order and
 * payment totals can never disagree by a floating-point epsilon.
 */

/** Round to 2 decimals using half-up on the integer paise value. */
function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sum a list of amounts, rounding once at the end. */
function sum(values = []) {
  return round2(values.reduce((acc, v) => acc + Number(v || 0), 0));
}

function multiply(unit, quantity) {
  return round2(Number(unit || 0) * Number(quantity || 0));
}

/** Percentage of an amount, e.g. percentOf(1000, 18) === 180. */
function percentOf(amount, percent) {
  return round2((Number(amount || 0) * Number(percent || 0)) / 100);
}

/** Compare two amounts for equality at paise precision. */
function equals(a, b) {
  return Math.round(Number(a || 0) * 100) === Math.round(Number(b || 0) * 100);
}

/** Clamp to zero — totals must never go negative after discounts. */
function atLeastZero(value) {
  const n = round2(value);
  return n < 0 ? 0 : n;
}

module.exports = { round2, sum, multiply, percentOf, equals, atLeastZero };
