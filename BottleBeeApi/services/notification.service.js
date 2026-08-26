'use strict';

const logger = require('../config/logger');
const { Notification, NotificationAction, NotificationTemplate, User } = require('../models');
const { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS } = require('../config/constants');

/**
 * Notification dispatch — SHARED SERVICE.
 *
 * This file holds only `notify` and its helpers, because almost every controller
 * needs to tell somebody something: an order changed status, a licence was
 * approved, stock ran low. Reading, marking read and managing templates live in
 * `notification.controller.js`.
 *
 * IN_APP messages are delivered by being written to the table, so they are
 * marked SENT immediately. EMAIL, SMS and PUSH are persisted as PENDING and
 * logged: no transport is wired up yet, and a delivery worker is expected to
 * claim PENDING rows. Every notification stays auditable either way, and wiring
 * a provider later changes only the dispatch step.
 *
 * `notify` never throws. A notification failure must not roll back the order,
 * payment or verification that triggered it — the business event already
 * happened, and losing a message is far cheaper than losing the transaction.
 */

/** Substitutes {{placeholders}}, including dotted paths like {{order.number}}. */
function render(text, variables = {}) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), variables);
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * Creates and dispatches one notification.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} [params.templateCode]  looked up for channel-specific copy
 * @param {string} [params.title]         fallback when no template matches
 * @param {string} [params.message]       fallback when no template matches
 * @param {string} [params.channel]       defaults to IN_APP
 * @param {object} [params.variables]     substituted into the template
 * @param {Array}  [params.actions]       [{ label, url }] deep links
 * @param {object} [params.transaction]   join the caller's transaction
 */
async function notify({
  userId,
  templateCode = null,
  title = null,
  message = null,
  channel = NOTIFICATION_CHANNEL.IN_APP,
  variables = {},
  referenceType = null,
  referenceId = null,
  metadata = null,
  actions = [],
  transaction = null,
}) {
  try {
    let resolvedTitle = title;
    let resolvedMessage = message;

    if (templateCode) {
      const template = await NotificationTemplate.findOne({
        where: { code: String(templateCode).toUpperCase(), channel, isActive: true },
        transaction,
      });

      if (template) {
        resolvedTitle = render(template.subject, variables) || title;
        resolvedMessage = render(template.body, variables) || message;
      }
    }

    if (!resolvedMessage) {
      logger.warn('Skipping notification %s for user %s: no message body', templateCode, userId);
      return null;
    }

    const isInApp = channel === NOTIFICATION_CHANNEL.IN_APP;

    const notification = await Notification.create(
      {
        userId,
        templateCode: templateCode ? String(templateCode).toUpperCase() : null,
        channel,
        title: resolvedTitle,
        message: resolvedMessage,
        status: isInApp ? NOTIFICATION_STATUS.SENT : NOTIFICATION_STATUS.PENDING,
        sentAt: isInApp ? new Date() : null,
        referenceType,
        referenceId,
        metadata,
      },
      { transaction }
    );

    if (actions.length) {
      await NotificationAction.bulkCreate(
        actions.map((action) => ({
          notificationId: notification.id,
          actionLabel: action.label,
          actionUrl: action.url,
        })),
        { transaction }
      );
    }

    if (!isInApp) {
      logger.info(
        'Queued %s notification %s for user %s (no transport configured — awaiting delivery worker)',
        channel, notification.id, userId
      );
    }

    return notification;
  } catch (err) {
    logger.error('Failed to create notification for user %s: %s', userId, err.message);
    return null;
  }
}

/** Fan-out for events that concern several people. Duplicate ids are collapsed. */
async function notifyMany(recipients, payload) {
  const unique = [...new Set(recipients.filter(Boolean).map(String))];
  return Promise.all(unique.map((userId) => notify({ ...payload, userId })));
}

/** Every active user — used by the broadcast path in the controller. */
async function activeUserIds() {
  const users = await User.findAll({ where: { isActive: true }, attributes: ['id'] });
  return users.map((u) => u.id);
}

module.exports = { notify, notifyMany, render, activeUserIds };
