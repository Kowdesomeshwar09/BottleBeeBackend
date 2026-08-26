'use strict';

const rateLimit = require('express-rate-limit');

const config = require('../config');
const { fail } = require('../utils/response');

/**
 * Rate limits. Kept in one place so the thresholds are reviewable together.
 * Limits are disabled under NODE_ENV=test so the suite is not throttled.
 */

const handler = (req, res) =>
  fail(res, 'Too many requests. Please slow down and try again shortly.', 429, [], 'RATE_LIMITED');

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  skip: () => config.isTest,
};

/** Applied to the whole API. */
const globalLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.max,
});

/**
 * Login, refresh and registration. Keyed on IP plus the submitted email so one
 * attacker cannot lock out every account from a shared NAT address, and so a
 * single account cannot be sprayed from one IP.
 */
const authLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.authMax,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
});

/** Password reset request / OTP style endpoints. */
const passwordResetLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
});

/** Checkout and payment initiation: protects inventory reservation from abuse. */
const checkoutLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.checkoutMax,
  keyGenerator: (req) => String(req.user?.id || req.ip),
});

/** High-frequency delivery location pings. */
const trackingLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => String(req.user?.id || req.ip),
});

module.exports = {
  globalLimiter,
  authLimiter,
  passwordResetLimiter,
  checkoutLimiter,
  trackingLimiter,
};
