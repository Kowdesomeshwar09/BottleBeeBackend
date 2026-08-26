'use strict';

const { Op } = require('sequelize');

const logger = require('../config/logger');
const { Notification, NotificationAction, NotificationTemplate } = require('../models');
const { NOTIFICATION_CHANNEL, NOTIFICATION_STATUS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const {
  ok, paginated, updated, deleted, fail,
} = require('../utils/response');
const notificationService = require('../services/notification.service');

/**
 * Notification inbox and templates.
 *
 * Reads are always scoped to the signed-in user: `userId` is taken from the
 * token, never from the body, so one customer cannot read another's inbox by
 * guessing an id.
 *
 * Dispatch itself lives in `services/notification.service.js` because nearly
 * every controller triggers a notification as a side effect.
 */

const SORTABLE = ['id', 'status', 'channel', 'createdAt', 'readAt'];
const TEMPLATE_SORTABLE = ['id', 'code', 'channel', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serializeNotification = (notification) => ({
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
});

const serializeTemplate = (template) => ({
  id: template.id,
  code: template.code,
  channel: template.channel,
  subject: template.subject,
  body: template.body,
  variables: template.variables,
  isActive: template.isActive,
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

/* -------------------------------------------------------------------------- */
/*                          LIST MY NOTIFICATIONS                             */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    // Scoped to the token holder, never to a body-supplied id.
    const where = { userId: req.user.id };
    if (req.body.status) where.status = req.body.status;
    if (req.body.channel) where.channel = req.body.channel;
    if (req.body.unreadOnly) where.readAt = null;
    if (req.body.search) where.message = { [Op.like]: `%${req.body.search}%` };

    const result = await Notification.findAndCountAll({
      where,
      include: [{ model: NotificationAction, as: 'actions', required: false }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map(serializeNotification),
      toPageMeta(result, { page, limit }),
      'Notifications fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching notifications', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              UNREAD COUNT                                  */
/* -------------------------------------------------------------------------- */
const unreadCount = async (req, res) => {
  try {
    const unread = await Notification.count({ where: { userId: req.user.id, readAt: null } });
    return ok(res, { unread }, 'Unread count fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching unread count', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             MARK ONE AS READ                               */
/* -------------------------------------------------------------------------- */
const markRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.body.id, userId: req.user.id },
    });
    if (!notification) return fail(res, 'Notification not found', 404);

    if (!notification.readAt) {
      await notification.update({
        readAt: new Date(),
        status: NOTIFICATION_STATUS.READ,
        updatedBy: req.user.id,
      });
    }

    return updated(res, serializeNotification(notification), 'Notification marked as read');
  } catch (error) {
    return fail(res, 'Error marking notification as read', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             MARK ALL AS READ                               */
/* -------------------------------------------------------------------------- */
const markAllRead = async (req, res) => {
  try {
    const [marked] = await Notification.update(
      { readAt: new Date(), status: NOTIFICATION_STATUS.READ, updatedBy: req.user.id },
      { where: { userId: req.user.id, readAt: null } }
    );

    return updated(res, { marked }, 'All notifications marked as read');
  } catch (error) {
    return fail(res, 'Error marking notifications as read', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       SEND A SYSTEM NOTIFICATION                           */
/* -------------------------------------------------------------------------- */
const sendSystem = async (req, res) => {
  try {
    let userIds = req.body.userIds || [];

    if (req.body.toAllUsers) {
      userIds = await notificationService.activeUserIds();
    }

    if (!userIds.length) {
      return fail(res, 'Specify at least one recipient, or set toAllUsers', 400);
    }

    const results = await notificationService.notifyMany(userIds, {
      templateCode: req.body.templateCode || null,
      title: req.body.title,
      message: req.body.message,
      channel: req.body.channel || NOTIFICATION_CHANNEL.IN_APP,
      variables: req.body.variables || {},
      referenceType: req.body.referenceType || null,
      referenceId: req.body.referenceId || null,
      actions: req.body.actions || [],
    });

    const sent = results.filter(Boolean).length;
    logger.info('User %s sent a system notification to %s recipient(s)', req.user.id, userIds.length);

    return ok(res, { sent, recipients: userIds.length }, 'Notification sent successfully');
  } catch (error) {
    return fail(res, 'Error sending notification', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             LIST TEMPLATES                                 */
/* -------------------------------------------------------------------------- */
const listTemplates = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: TEMPLATE_SORTABLE,
      defaultSort: 'code',
      defaultOrder: 'ASC',
    });

    const where = {};
    if (req.body.channel) where.channel = req.body.channel;
    if (req.body.search) {
      where[Op.or] = [
        { code: { [Op.like]: `%${req.body.search}%` } },
        { subject: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await NotificationTemplate.findAndCountAll({ where, limit, offset, order });

    return paginated(
      res,
      result.rows.map(serializeTemplate),
      toPageMeta(result, { page, limit }),
      'Templates fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching templates', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        CREATE OR UPDATE A TEMPLATE                         */
/* -------------------------------------------------------------------------- */
/** Upsert keyed on (code, channel); a soft-deleted match is restored. */
const saveTemplate = async (req, res) => {
  try {
    const code = String(req.body.code).toUpperCase();

    const existing = await NotificationTemplate.findOne({
      where: { code, channel: req.body.channel },
      paranoid: false,
    });

    if (existing) {
      if (existing.deletedAt) await existing.restore();
      await existing.update({
        subject: req.body.subject ?? existing.subject,
        body: req.body.body ?? existing.body,
        variables: req.body.variables ?? existing.variables,
        isActive: req.body.isActive ?? existing.isActive,
        updatedBy: req.user.id,
      });
      return updated(res, serializeTemplate(existing), 'Template saved successfully');
    }

    const template = await NotificationTemplate.create({
      code,
      channel: req.body.channel,
      subject: req.body.subject || null,
      body: req.body.body,
      variables: req.body.variables || null,
      createdBy: req.user.id,
    });

    return updated(res, serializeTemplate(template), 'Template saved successfully');
  } catch (error) {
    return fail(res, 'Error saving template', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            PREVIEW A TEMPLATE                              */
/* -------------------------------------------------------------------------- */
const previewTemplate = async (req, res) => {
  try {
    const template = await NotificationTemplate.findByPk(req.body.id);
    if (!template) return fail(res, 'Notification template not found', 404);

    return ok(
      res,
      {
        code: template.code,
        channel: template.channel,
        subject: notificationService.render(template.subject, req.body.variables || {}),
        body: notificationService.render(template.body, req.body.variables || {}),
      },
      'Template rendered successfully'
    );
  } catch (error) {
    return fail(res, 'Error rendering template', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             DELETE A TEMPLATE                              */
/* -------------------------------------------------------------------------- */
/**
 * Soft delete. Sends that reference a missing template fall back to the literal
 * title and message the caller supplied, so removing one never silences an event.
 */
const deleteTemplate = async (req, res) => {
  try {
    const template = await NotificationTemplate.findByPk(req.body.id);
    if (!template) return fail(res, 'Notification template not found', 404);

    await template.update({ deletedBy: req.user.id });
    await template.destroy();

    return deleted(res, 'Template deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting template', 500, [{ message: error.message }]);
  }
};

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  sendSystem,
  listTemplates,
  saveTemplate,
  previewTemplate,
  deleteTemplate,
  serializeNotification,
  serializeTemplate,
};
