'use strict';

const pricingService = require('../../services/pricing.service');
const config = require('../../config');
const { DISCOUNT_TYPE } = require('../../config/constants');

/**
 * The pricing engine.
 *
 * The cart preview, the order written at checkout and the amount charged all
 * come from `computeTotals`. If it is wrong, the customer is either overcharged
 * or the platform loses money — and the per-line apportionment has to reconcile
 * exactly, because those line figures become the invoice.
 */
describe('pricing.computeTotals', () => {
  const line = (overrides = {}) => ({
    productVariantId: 1,
    quantity: 1,
    unitPrice: 100,
    taxPercent: 18,
    ...overrides,
  });

  describe('without a coupon', () => {
    it('computes subtotal, tax and total for a single line', () => {
      const t = pricingService.computeTotals([line({ quantity: 2, unitPrice: 150 })]);

      expect(t.subtotal).toBe(300);
      expect(t.taxTotal).toBe(54);
      expect(t.discountTotal).toBe(0);
      expect(t.grandTotal).toBe(300 + 54 + t.deliveryFee);
    });

    it('sums several lines', () => {
      const t = pricingService.computeTotals([
        line({ quantity: 4, unitPrice: 150 }),
        line({ productVariantId: 2, quantity: 1, unitPrice: 5899 }),
      ]);

      expect(t.subtotal).toBe(6499);
      expect(t.totalQuantity).toBe(5);
    });

    it('handles an empty cart without producing NaN', () => {
      const t = pricingService.computeTotals([]);

      expect(t.subtotal).toBe(0);
      expect(t.taxTotal).toBe(0);
      expect(t.grandTotal).toBe(t.deliveryFee);
    });

    it('applies a zero tax rate correctly', () => {
      const t = pricingService.computeTotals([line({ taxPercent: 0, unitPrice: 500 })]);
      expect(t.taxTotal).toBe(0);
    });
  });

  describe('delivery fee', () => {
    it('charges the flat fee below the threshold', () => {
      const t = pricingService.computeTotals([line({ unitPrice: 100 })]);
      expect(t.deliveryFee).toBe(config.fulfilment.deliveryFee);
      expect(t.amountToFreeDelivery).toBeGreaterThan(0);
    });

    it('waives it at or above the threshold', () => {
      const t = pricingService.computeTotals([
        line({ unitPrice: config.fulfilment.freeDeliveryAbove }),
      ]);

      expect(t.deliveryFee).toBe(0);
      expect(t.amountToFreeDelivery).toBe(0);
    });

    it('decides on the discounted subtotal, not the gross one', () => {
      // A coupon that drops the order below the threshold reinstates the fee:
      // the customer is paying less, so the free-delivery benefit is not earned.
      const coupon = {
        discountType: DISCOUNT_TYPE.FIXED,
        discountValue: 600,
        maxDiscountAmount: null,
      };

      const gross = config.fulfilment.freeDeliveryAbove + 100;
      const t = pricingService.computeTotals([line({ unitPrice: gross })], { coupon });

      expect(t.subtotal).toBe(gross);
      expect(t.deliveryFee).toBe(config.fulfilment.deliveryFee);
    });
  });

  describe('with a coupon', () => {
    it('applies a percentage discount', () => {
      const coupon = {
        discountType: DISCOUNT_TYPE.PERCENTAGE,
        discountValue: 10,
        maxDiscountAmount: null,
      };

      const t = pricingService.computeTotals([line({ unitPrice: 1000 })], { coupon });
      expect(t.discountTotal).toBe(100);
    });

    it('honours the maximum discount ceiling', () => {
      const coupon = {
        discountType: DISCOUNT_TYPE.PERCENTAGE,
        discountValue: 20,
        maxDiscountAmount: 500,
      };

      // 20% of 6499 is 1299.80, which the 500 ceiling must cap.
      const t = pricingService.computeTotals([line({ unitPrice: 6499 })], { coupon });
      expect(t.discountTotal).toBe(500);
    });

    it('never discounts more than the subtotal', () => {
      const coupon = {
        discountType: DISCOUNT_TYPE.FIXED,
        discountValue: 5000,
        maxDiscountAmount: null,
      };

      // A discount larger than the order must take it to zero, never below —
      // otherwise the platform pays the customer to order.
      const t = pricingService.computeTotals([line({ unitPrice: 100 })], { coupon });

      expect(t.discountTotal).toBe(100);
      expect(t.grandTotal).toBeGreaterThanOrEqual(0);
    });

    it('taxes the discounted amount, not the gross', () => {
      const coupon = {
        discountType: DISCOUNT_TYPE.FIXED,
        discountValue: 500,
        maxDiscountAmount: null,
      };

      const t = pricingService.computeTotals([line({ unitPrice: 6499, taxPercent: 18 })], { coupon });

      // 6499 - 500 = 5999, taxed at 18% = 1079.82.
      expect(t.taxTotal).toBe(1079.82);
      expect(t.grandTotal).toBe(5999 + 1079.82 + t.deliveryFee);
    });
  });

  describe('per-line discount apportionment', () => {
    it('splits the discount by line value share', () => {
      const coupon = {
        discountType: DISCOUNT_TYPE.PERCENTAGE,
        discountValue: 20,
        maxDiscountAmount: 500,
      };

      const t = pricingService.computeTotals([
        line({ productVariantId: 1, quantity: 1, unitPrice: 5899 }),
        line({ productVariantId: 2, quantity: 4, unitPrice: 150 }),
      ], { coupon });

      const [malt, beer] = t.lines;

      // 5899/6499 and 600/6499 of a 500 discount.
      expect(malt.discountAmount).toBe(453.84);
      expect(beer.discountAmount).toBe(46.16);
    });

    it('makes the line discounts sum exactly to the order discount', () => {
      // The rounding remainder must land somewhere, or the invoice will not
      // reconcile against the order total.
      const coupon = {
        discountType: DISCOUNT_TYPE.FIXED,
        discountValue: 100,
        maxDiscountAmount: null,
      };

      const t = pricingService.computeTotals([
        line({ productVariantId: 1, unitPrice: 33.33 }),
        line({ productVariantId: 2, unitPrice: 33.33 }),
        line({ productVariantId: 3, unitPrice: 33.34 }),
      ], { coupon });

      const apportioned = t.lines.reduce((sum, l) => sum + l.discountAmount, 0);
      expect(Math.round(apportioned * 100) / 100).toBe(t.discountTotal);
    });

    it('never lets a line discount exceed the line itself', () => {
      const coupon = {
        discountType: DISCOUNT_TYPE.FIXED,
        discountValue: 900,
        maxDiscountAmount: null,
      };

      const t = pricingService.computeTotals([
        line({ productVariantId: 1, unitPrice: 500 }),
        line({ productVariantId: 2, unitPrice: 500 }),
      ], { coupon });

      t.lines.forEach((l) => {
        expect(l.discountAmount).toBeLessThanOrEqual(l.lineSubtotal);
      });
    });

    it('makes the line totals reconcile with the order total', () => {
      const coupon = {
        discountType: DISCOUNT_TYPE.PERCENTAGE,
        discountValue: 15,
        maxDiscountAmount: null,
      };

      const t = pricingService.computeTotals([
        line({ productVariantId: 1, quantity: 3, unitPrice: 799 }),
        line({ productVariantId: 2, quantity: 2, unitPrice: 1249.5 }),
        line({ productVariantId: 3, quantity: 1, unitPrice: 4999 }),
      ], { coupon });

      const lineSum = t.lines.reduce((sum, l) => sum + l.lineTotal, 0);
      const expected = t.subtotal - t.discountTotal + t.taxTotal;

      expect(Math.round(lineSum * 100) / 100).toBe(Math.round(expected * 100) / 100);
      expect(t.grandTotal).toBe(Math.round((expected + t.deliveryFee) * 100) / 100);
    });
  });

  describe('assertAmountMatches', () => {
    it('accepts a matching amount at paise precision', () => {
      expect(pricingService.assertAmountMatches(2348.2, '2348.20')).toBe(true);
    });

    it('rejects a tampered amount', () => {
      expect(pricingService.assertAmountMatches(2348.2, 1.0)).toBe(false);
    });
  });
});
