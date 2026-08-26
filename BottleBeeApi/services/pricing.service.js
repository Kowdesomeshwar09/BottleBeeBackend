'use strict';

const config = require('../config');
const money = require('../utils/money');
const promotionService = require('./promotion.service');

/**
 * The single pricing engine.
 *
 * Cart preview, checkout and the payment amount all call `computeTotals`, so the
 * figure a customer is shown is by construction the figure they are charged.
 * The client never sends a price, a discount or a total — only variant ids,
 * quantities and a coupon code.
 *
 * Order of operations:
 *   1. line subtotal      = unit price x quantity
 *   2. subtotal           = sum of line subtotals
 *   3. discount           = coupon value, capped at the subtotal
 *   4. per-line discount  = discount apportioned by line share, remainder on the last line
 *   5. per-line tax       = the line's tax rate applied to (line subtotal - line discount)
 *   6. delivery fee       = flat fee, waived above the free-delivery threshold
 *   7. grand total        = subtotal - discount + tax + delivery fee
 *
 * Every intermediate value is rounded to two decimals at assignment, and the
 * apportioned discount is reconciled against the total so the per-line amounts
 * always sum exactly to the order discount.
 */

/**
 * @param {Array} items  [{ productVariantId, quantity, unitPrice, taxPercent, productId, productName, variantLabel, sku }]
 * @param {object} [options]
 * @param {object} [options.coupon]        validated coupon row, or null
 * @param {number} [options.deliveryFee]   override the configured flat fee
 * @param {boolean} [options.freeDelivery] force the fee to zero
 */
function computeTotals(items = [], options = {}) {
  const lines = items.map((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = money.round2(item.unitPrice);
    return {
      ...item,
      quantity,
      unitPrice,
      lineSubtotal: money.multiply(unitPrice, quantity),
      taxPercent: Number(item.taxPercent || 0),
    };
  });

  const subtotal = money.sum(lines.map((l) => l.lineSubtotal));

  const discountTotal = options.coupon
    ? promotionService.computeDiscount(options.coupon, subtotal)
    : money.round2(options.discountTotal || 0);

  // Apportion the order discount across lines by value share. The last line
  // absorbs the rounding remainder so the parts sum exactly to the whole.
  let allocated = 0;
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1;

    if (subtotal <= 0 || discountTotal <= 0) {
      line.discountAmount = 0;
    } else if (isLast) {
      line.discountAmount = money.atLeastZero(money.round2(discountTotal - allocated));
    } else {
      line.discountAmount = money.round2((discountTotal * line.lineSubtotal) / subtotal);
      allocated = money.round2(allocated + line.discountAmount);
    }

    // A line's discount can never exceed the line itself.
    line.discountAmount = Math.min(line.discountAmount, line.lineSubtotal);

    const taxable = money.atLeastZero(line.lineSubtotal - line.discountAmount);
    line.taxAmount = money.percentOf(taxable, line.taxPercent);
    line.lineTotal = money.round2(taxable + line.taxAmount);
  });

  const taxTotal = money.sum(lines.map((l) => l.taxAmount));
  const discountedSubtotal = money.atLeastZero(subtotal - discountTotal);

  const baseFee = options.deliveryFee !== undefined
    ? money.round2(options.deliveryFee)
    : money.round2(config.fulfilment.deliveryFee);

  const deliveryFee = options.freeDelivery || discountedSubtotal >= config.fulfilment.freeDeliveryAbove
    ? 0
    : baseFee;

  const grandTotal = money.round2(discountedSubtotal + taxTotal + deliveryFee);

  return {
    lines,
    subtotal,
    discountTotal,
    taxTotal,
    deliveryFee,
    grandTotal,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    freeDeliveryThreshold: config.fulfilment.freeDeliveryAbove,
    amountToFreeDelivery: deliveryFee > 0
      ? money.round2(config.fulfilment.freeDeliveryAbove - discountedSubtotal)
      : 0,
  };
}

/**
 * Confirms a client-supplied amount matches what the server computed.
 * Used before a payment is captured, so a tampered amount cannot be charged.
 */
function assertAmountMatches(expected, actual) {
  return money.equals(expected, actual);
}

module.exports = { computeTotals, assertAmountMatches };
