'use strict';

const jwt = require('jsonwebtoken');

const config = require('../config');
const AppError = require('./AppError');

/**
 * Access tokens are short-lived and carry the identity plus a snapshot of
 * roles/permissions so the authorize middleware does not need a DB round trip
 * on every request. Refresh tokens carry only the subject and a token id; the
 * authoritative record lives in `refresh_tokens`.
 */

function signAccessToken(payload) {
  return jwt.sign(
    {
      sub: String(payload.userId),
      email: payload.email,
      roles: payload.roles || [],
      permissions: payload.permissions || [],
      type: 'access',
    },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn, issuer: config.jwt.issuer }
  );
}

function signRefreshToken(payload) {
  return jwt.sign(
    { sub: String(payload.userId), jti: payload.tokenId, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn, issuer: config.jwt.issuer }
  );
}

function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, { issuer: config.jwt.issuer });
    if (decoded.type !== 'access') throw AppError.unauthorized('Invalid token type');
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'TokenExpiredError') throw AppError.unauthorized('Access token expired');
    throw AppError.unauthorized('Invalid access token');
  }
}

function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret, { issuer: config.jwt.issuer });
    if (decoded.type !== 'refresh') throw AppError.unauthorized('Invalid token type');
    return decoded;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'TokenExpiredError') throw AppError.unauthorized('Refresh token expired');
    throw AppError.unauthorized('Invalid refresh token');
  }
}

/** Converts a jwt-style duration (15m, 7d, 3600) into a future Date. */
function expiresAtFrom(duration) {
  const value = String(duration);
  const match = value.match(/^(\d+)([smhdw])$/);
  const now = Date.now();

  if (!match) {
    const seconds = Number.parseInt(value, 10);
    return new Date(now + (Number.isNaN(seconds) ? 0 : seconds * 1000));
  }

  const amount = Number.parseInt(match[1], 10);
  const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2]];
  return new Date(now + amount * unitMs);
}

/** Extracts a bearer token from the Authorization header. */
function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  expiresAtFrom,
  extractBearerToken,
};
