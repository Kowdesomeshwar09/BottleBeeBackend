'use strict';

const logger = require('../config/logger');

/**
 * Append-only audit trail for sensitive operations.
 *
 * Audit writes must never break the operation they are recording: a failure is
 * logged and swallowed. Pass a transaction when the audit row should roll back
 * with the business write (order transitions, refunds), and omit it when the
 * record must survive a rollback (failed logins).
 */

/** Attribute names that must never reach the audit table. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'tokenHash',
  'token_hash',
  'documentNumber',
  'documentNumberHash',
  'document_number_hash',
  'keySecret',
  'signature',
]);

function redact(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();

  return Object.entries(value).reduce((acc, [key, val]) => {
    acc[key] = REDACTED_KEYS.has(key) ? '[REDACTED]' : redact(val);
    return acc;
  }, {});
}

/**
 * @param {object} params
 * @param {string} params.action        AUDIT_ACTIONS code
 * @param {string} params.entityType    e.g. 'Order'
 * @param {number|string} [params.entityId]
 * @param {number|string} [params.actorUserId]
 * @param {object} [params.oldValues]
 * @param {object} [params.newValues]
 * @param {object} [params.req]         request, for ip / user agent / actor
 * @param {object} [params.transaction]
 */
async function recordAudit({
  action,
  entityType,
  entityId = null,
  actorUserId = null,
  oldValues = null,
  newValues = null,
  req = null,
  transaction = null,
}) {
  try {
    // Required lazily: models depend on config, and config must not depend on
    // models, so importing at module scope would create a cycle.
    const { AuditLog } = require('../models');

    await AuditLog.create(
      {
        actorUserId: actorUserId ?? req?.user?.id ?? null,
        action,
        entityType,
        entityId: entityId ?? null,
        oldValues: oldValues ? redact(oldValues) : null,
        newValues: newValues ? redact(newValues) : null,
        ipAddress: req ? clientIp(req) : null,
        userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 500) : null,
      },
      { transaction }
    );
  } catch (err) {
    logger.error('Failed to write audit log for action %s on %s: %s', action, entityType, err.message);
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : (forwarded || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || null;
  return ip ? String(ip).slice(0, 80) : null;
}

module.exports = { recordAudit, redact, clientIp, REDACTED_KEYS };
