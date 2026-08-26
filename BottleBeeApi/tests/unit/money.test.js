'use strict';

const money = require('../../utils/money');

/**
 * Money arithmetic. Every monetary column is DECIMAL(10,2), so anything that
 * reaches the database must already be rounded to paise — a value carrying
 * floating-point residue either gets silently truncated or makes a total
 * disagree with the sum of its own lines.
 */
describe('money', () => {
  describe('round2', () => {
    it('rounds to two decimals', () => {
      expect(money.round2(10.456)).toBe(10.46);
      expect(money.round2(10.454)).toBe(10.45);
      expect(money.round2(10)).toBe(10);
    });

    it('rounds half away from zero rather than to even', () => {
      expect(money.round2(2.345)).toBe(2.35);
      expect(money.round2(0.125)).toBe(0.13);
    });

    it('absorbs binary floating-point residue', () => {
      // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754.
      expect(money.round2(0.1 + 0.2)).toBe(0.3);
      expect(money.round2(1.005)).toBe(1.01);
    });

    it('treats non-numeric input as zero rather than producing NaN', () => {
      expect(money.round2(undefined)).toBe(0);
      expect(money.round2(null)).toBe(0);
      expect(money.round2('not a number')).toBe(0);
      expect(money.round2(Infinity)).toBe(0);
    });
  });

  describe('sum', () => {
    it('rounds once at the end, not per element', () => {
      // Three thirds of a rupee should total exactly one rupee.
      expect(money.sum([0.333, 0.333, 0.334])).toBe(1);
    });

    it('handles an empty list', () => {
      expect(money.sum([])).toBe(0);
    });

    it('ignores null and undefined entries', () => {
      expect(money.sum([10, null, 5, undefined])).toBe(15);
    });
  });

  describe('multiply', () => {
    it('multiplies a unit price by a quantity', () => {
      expect(money.multiply(150, 4)).toBe(600);
      expect(money.multiply(5899, 1)).toBe(5899);
    });

    it('rounds the product', () => {
      expect(money.multiply(33.333, 3)).toBe(100);
    });
  });

  describe('percentOf', () => {
    it('computes a percentage', () => {
      expect(money.percentOf(1000, 18)).toBe(180);
      expect(money.percentOf(6499, 20)).toBe(1299.8);
    });

    it('returns zero for a zero rate', () => {
      expect(money.percentOf(1000, 0)).toBe(0);
    });
  });

  describe('equals', () => {
    it('compares at paise precision', () => {
      expect(money.equals(10.001, 10.002)).toBe(true);
      expect(money.equals(10.0, 10.01)).toBe(false);
    });

    it('treats a numeric string and a number as equal', () => {
      // Sequelize can hand back DECIMAL as a string depending on the driver.
      expect(money.equals('2348.20', 2348.2)).toBe(true);
    });
  });

  describe('atLeastZero', () => {
    it('clamps a negative to zero', () => {
      // A discount larger than the subtotal must not pay the customer.
      expect(money.atLeastZero(-50)).toBe(0);
    });

    it('leaves a positive alone', () => {
      expect(money.atLeastZero(50.005)).toBe(50.01);
    });
  });
});
