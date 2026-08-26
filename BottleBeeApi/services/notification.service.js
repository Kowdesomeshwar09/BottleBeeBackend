'use strict';

const { Op } = require('sequelize');

const logger = require('../config/logger');
const {
  sequelize, Notification, NotificationAction, NotificationTemplate, User,
} = require('../models');
const { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');

/**
 * Notifications.
 *
 * IN_APP messages are delivered by being written to the table, so they are
 * marked SENT immediately. EMAIL, SMS and PUSH are persisted as PENDING and
 * logged: no transport is wired up yet, and a delivery worker is expected to
 * claim PENDING rows. That keeps every notification auditable either way, and
 * means wiring a provider later changes only the dispatch step.
 *
 * `notify` never throws. A notification failure must not roll back the order,
 * payment or verification that triggered it.
 */

const SORTABLE = ['id', 'status', 'channel', 'createdAt', 'readAt'];

/** Replaces {{placeholders}} in a template body. */
function render(text, variables = {}) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
    const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), variables);
    return value === undefined || value === null ? '' : String(value);
  });
}

function serialize(notification) {
  return {
    id: notification.id,
    userId: notification.userId,
    templateCode: notification.templateCode,
    channel: notification.channel,
    title: notification.title,
    message: notification.message,
    status: notification.status,
    sentAt: notification.sentAt,
    readAt: notification.readAt,
    referenceType: notification.referenceType,
    referenceId: notification.referenceId,
    metadata: notification.metadata,
    actions: (notification.actions || []).map((a) => ({
      id: a.id, label: a.actionLabel, url: a.actionUrl,
    })),
    createdAt: notification.createdAt,
  };
}

/**
 * Creates and dispatches one notification.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} [params.templateCode]  looked up for channel-specific copy
 * @param {string} [params.title]         overrides the template subject
 * @param {string} [params.message]       overrides the template body
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
    // Never let a notification break the business operation that triggered it.
    logger.error('Failed to create notification for user %s: %s', userId, err.message);
    return null;
  }
}

/** Fan-out helper for status changes that concern several people. */
async function notifyMany(recipients, payload) {
  const unique = [...new Set(recipients.filter(Boolean).map(String))];
  return Promise.all(unique.map((userId) => notify({ ...payload, userId })));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function list(body, req) {
  const { page, limit, offset, order } = buildPagination(body, { sortable: SORTABLE });

  const where = { userId: req.user.id };
  if (body.status) where.status = body.status;
  if (body.channel) where.channel = body.channel;
  if (body.unreadOnly) where.readAt = null;
  if (body.search) where.message = { [Op.like]: `%${body.search}%` };

  const result = await Notification.findAndCountAll({
    where,
    include: [{ model: NotificationAction, as: 'actions', required: false }],
    limit,
    offset,
    order,
    distinct: true,
  });

  return { rows: result.rows.map(serialize), meta: toPageMeta(result, { page, limit }) };
}

async function unreadCount(req) {
  const count = await Notification.count({ where: { userId: req.user.id, readAt: null } });
  return { unread: count };
}

async function markRead(body, req) {
  const notification = await Notification.findOne({
    where: { id: body.id, userId: req.user.id },
  });
  if (!notification) throw AppError.notFound('Notification not found');

  if (!notification.readAt) {
    await notification.update({
      readAt: new Date(),
      status: NOTIFICATION_STATUS.READ,
      updatedBy: req.user.id,
    });
  }

  return serialize(notification);
}

async function markAllRead(req) {
  const [affected] = await Notification.update(
    { readAt: new Date(), status: NOTIFICATION_STATUS.READ, updatedBy: req.user.id },
    { where: { userId: req.user.id, readAt: null } }
  );
  return { marked: affected };
}

// ---------------------------------------------------------------------------
// Staff dispatch
// ---------------------------------------------------------------------------

/** Sends a system notification to one user, a list of users, or every user. */
async function sendSystem(body, req) {
  let userIds = body.userIds || [];

  if (body.toAllUsers) {
    const users = await User.findAll({ where: { isActive: true }, attributes: ['id'] });
    userIds = users.map((u) => u.id);
  }

  if (!userIds.length) {
    throw AppError.badRequest('Specify at least one recipient, or set toAllUsers');
  }

  const created = await notifyMany(userIds, {
    templateCode: body.templateCode || null,
    title: body.title,
    message: body.message,
    channel: body.channel || NOTIFICATION_CHANNEL.IN_APP,
    variables: body.variables || {},
    referenceType: body.referenceType || null,
    referenceId: body.referenceId || null,
    actions: body.actions || [],
  });

  logger.info('User %s sent a system notification to %s recipient(s)', req.user.id, userIds.length);

  return { sent: created.filter(Boolean).length, recipients: userIds.length };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function serializeTemplate(template) {
  return {
    id: template.id,
    code: template.code,
    channel: template.channel,
    subject: template.subject,
    body: template.body,
    variables: template.variables,
    isActive: template.isActive,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

async function listTemplates(body) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: ['id', 'code', 'channel', 'createdAt'],
    defaultSort: 'code',
    defaultOrder: 'ASC',
  });

  const where = {};
  if (body.channel) where.channel = body.channel;
  if (body.search) {
    where[Op.or] = [
      { code: { [Op.like]: `%${body.search}%` } },
      { subject: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const result = await NotificationTemplate.findAndCountAll({ where, limit, offset, order });
  return { rows: result.rows.map(serializeTemplate), meta: toPageMeta(result, { page, limit }) };
}

async function saveTemplate(body, req) {
  const code = String(body.code).toUpperCase();
  const existing = await NotificationTemplate.findOne({
    where: { code, channel: body.channel },
    paranoid: false,
  });

  if (existing) {
    if (existing.deletedAt) await existing.restore();
    await existing.update({
      subject: body.subject ?? existing.subject,
      body: body.body ?? existing.body,
      variables: body.variables ?? existing.variables,
      isActive: body.isActive ?? existing.isActive,
      updatedBy: req.user.id,
    });
    return serializeTemplate(existing);
  }

  const template = await NotificationTemplate.create({
    code,
    channel: body.channel,
    subject: body.subject || null,
    body: body.body,
    variables: body.variables || null,
    createdBy: req.user.id,
  });

  return serializeTemplate(template);
}

async function deleteTemplate(body, req) {
  const template = await NotificationTemplate.findByPk(body.id);
  if (!template) throw AppError.notFound('Notification template not found');

  await template.update({ deletedBy: req.user.id });
  await template.destroy();

  return { deleted: true };
}

/** Renders a template against sample variables without sending anything. */
async function previewTemplate(body) {
  const template = await NotificationTemplate.findByPk(body.id);
  if (!template) throw AppError.notFound('Notification template not found');

  return {
    code: template.code,
    channel: template.channel,
    subject: render(template.subject, body.variables || {}),
    body: render(template.body, body.variables || {}),
  };
}

module.exports = {
  notify,
  notifyMany,
  list,
  unreadCount,
  markRead,
  markAllRead,
  sendSystem,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  previewTemplate,
  render,
  serialize,
  serializeTemplate,
  sequelize,
};
