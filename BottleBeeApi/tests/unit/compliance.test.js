'use strict';

const dates = require('../../utils/dates');

/**
 * The date and time rules behind alcohol compliance.
 *
 * `calculateAge` decides whether a sale is lawful at all, and
 * `isWithinTimeWindow` decides whether it is lawful *now*. Both are pure, and
 * both have edge cases — a birthday today, a sale window crossing midnight —
 * where being wrong means selling to a minor or outside permitted hours.
 */
describe('compliance date rules', () => {
  describe('calculateAge', () => {
    const on = (iso) => new Date(`${iso}T12:00:00Z`);

    it('counts whole years', () => {
      expect(dates.calculateAge('1994-06-15', on('2026-06-15'))).toBe(32);
      expect(dates.calculateAge('2000-01-01', on('2026-01-01'))).toBe(26);
    });

    it('does not count a birthday that has not arrived', () => {
      // The day before turning 21, the customer is still 20 and cannot buy.
      expect(dates.calculateAge('2005-08-27', on('2026-08-26'))).toBe(20);
    });

    it('counts the birthday itself', () => {
      expect(dates.calculateAge('2005-08-26', on('2026-08-26'))).toBe(21);
    });

    it('handles a 29 February birth date', () => {
      expect(dates.calculateAge('2004-02-29', on('2026-02-28'))).toBe(21);
      expect(dates.calculateAge('2004-02-29', on('2026-03-01'))).toBe(22);
    });

    it('returns null for a missing or unparseable date rather than zero', () => {
      // Zero would read as "newborn" and still compare as under age, but null
      // lets the caller say "no date of birth on file", which is the real problem.
      expect(dates.calculateAge(null)).toBeNull();
      expect(dates.calculateAge(undefined)).toBeNull();
      expect(dates.calculateAge('not a date')).toBeNull();
    });
  });

  describe('isAtLeastAge', () => {
    const on = (iso) => new Date(`${iso}T12:00:00Z`);

    it('permits someone exactly at the minimum age', () => {
      expect(dates.isAtLeastAge('2005-08-26', 21, on('2026-08-26'))).toBe(true);
    });

    it('refuses someone one day short', () => {
      expect(dates.isAtLeastAge('2005-08-27', 21, on('2026-08-26'))).toBe(false);
    });

    it('refuses when there is no date of birth', () => {
      expect(dates.isAtLeastAge(null, 21)).toBe(false);
    });

    it('respects a higher regional minimum', () => {
      // Maharashtra and Delhi require 25, not 21.
      expect(dates.isAtLeastAge('2003-01-01', 21, on('2026-08-26'))).toBe(true);
      expect(dates.isAtLeastAge('2003-01-01', 25, on('2026-08-26'))).toBe(false);
    });
  });

  describe('isWithinTimeWindow', () => {
    const at = (h, m = 0) => {
      const d = new Date(2026, 7, 26, h, m, 0);
      return d;
    };

    it('permits a time inside a normal window', () => {
      expect(dates.isWithinTimeWindow('10:00:00', '23:00:00', at(14))).toBe(true);
    });

    it('refuses a time before opening', () => {
      expect(dates.isWithinTimeWindow('10:00:00', '23:00:00', at(9, 59))).toBe(false);
    });

    it('refuses a time after closing', () => {
      expect(dates.isWithinTimeWindow('10:00:00', '23:00:00', at(23, 1))).toBe(false);
    });

    it('includes both boundaries', () => {
      expect(dates.isWithinTimeWindow('10:00:00', '23:00:00', at(10, 0))).toBe(true);
      expect(dates.isWithinTimeWindow('10:00:00', '23:00:00', at(23, 0))).toBe(true);
    });

    it('handles a window that wraps past midnight', () => {
      // A 17:00-01:00 licence: 23:00 and 00:30 are inside, 02:00 is not.
      expect(dates.isWithinTimeWindow('17:00:00', '01:00:00', at(23))).toBe(true);
      expect(dates.isWithinTimeWindow('17:00:00', '01:00:00', at(0, 30))).toBe(true);
      expect(dates.isWithinTimeWindow('17:00:00', '01:00:00', at(2))).toBe(false);
      expect(dates.isWithinTimeWindow('17:00:00', '01:00:00', at(16, 59))).toBe(false);
    });

    it('treats an unconfigured window as unrestricted', () => {
      // No configured hours must not mean "never sell".
      expect(dates.isWithinTimeWindow(null, null, at(3))).toBe(true);
      expect(dates.isWithinTimeWindow('10:00:00', null, at(3))).toBe(true);
    });

    it('accepts HH:MM as well as HH:MM:SS', () => {
      expect(dates.isWithinTimeWindow('10:00', '23:00', at(14))).toBe(true);
    });
  });

  describe('timeToMinutes', () => {
    it('converts to minutes since midnight', () => {
      expect(dates.timeToMinutes('00:00:00')).toBe(0);
      expect(dates.timeToMinutes('10:30')).toBe(630);
      expect(dates.timeToMinutes('23:59:59')).toBe(1439);
    });

    it('returns null for unusable input', () => {
      expect(dates.timeToMinutes(null)).toBeNull();
      expect(dates.timeToMinutes('nonsense')).toBeNull();
    });
  });

  describe('toDateOnly', () => {
    it('formats as YYYY-MM-DD in local time', () => {
      expect(dates.toDateOnly(new Date(2026, 7, 26))).toBe('2026-08-26');
      expect(dates.toDateOnly(new Date(2026, 0, 5))).toBe('2026-01-05');
    });
  });

  describe('addDays and addMinutes', () => {
    it('advances a date', () => {
      const base = new Date('2026-08-26T10:00:00Z');
      expect(dates.addDays(base, 730).getUTCFullYear()).toBe(2028);
      expect(dates.addMinutes(base, 30).toISOString()).toBe('2026-08-26T10:30:00.000Z');
    });
  });

  describe('isPast', () => {
    it('detects an elapsed instant', () => {
      expect(dates.isPast(new Date(Date.now() - 1000))).toBe(true);
      expect(dates.isPast(new Date(Date.now() + 60000))).toBe(false);
      expect(dates.isPast(null)).toBe(false);
    });
  });
});
