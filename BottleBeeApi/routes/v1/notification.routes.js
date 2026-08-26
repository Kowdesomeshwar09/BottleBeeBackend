'use strict';

const express = require('express');

const controller = require('../../controllers/notification.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/notification.validator');

const router = express.Router();


/**
 * @openapi
 * /api/v1/notifications/list:
 *   post:
 *     tags: [Notifications]
 *     summary: List your notifications
 *     description: 'Requires permission: `NOTIFICATION_VIEW`. Scoped to the signed-in user.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/NotificationStatus' }
 *                   channel: { $ref: '#/components/schemas/NotificationChannel' }
 *                   unreadOnly: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Notifications
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/list',
  validate(schemas.listNotificationsSchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_VIEW),
  controller.list
);

/**
 * @openapi
 * /api/v1/notifications/unread-count:
 *   post:
 *     tags: [Notifications]
 *     summary: Number of unread notifications
 *     description: 'Requires permission: `NOTIFICATION_VIEW`. Cheap enough to poll for a badge count.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Unread count
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/unread-count',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_VIEW),
  controller.unreadCount
);

/**
 * @openapi
 * /api/v1/notifications/mark-read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark one notification as read
 *     description: 'Requires permission: `NOTIFICATION_VIEW`. You may only mark your own notifications.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Marked read
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/mark-read',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_VIEW),
  controller.markRead
);

/**
 * @openapi
 * /api/v1/notifications/mark-all-read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark every notification as read
 *     description: 'Requires permission: `NOTIFICATION_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Marked read
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/mark-all-read',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_VIEW),
  controller.markAllRead
);

/**
 * @openapi
 * /api/v1/notifications/send:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a system notification
 *     description: |
 *       Requires permission: `NOTIFICATION_SEND`. Target specific users with
 *       `userIds`, or every active user with `toAllUsers`.
 *
 *       `IN_APP` notifications are delivered immediately. `EMAIL`, `SMS` and
 *       `PUSH` are persisted as PENDING for a delivery worker — no transport is
 *       configured yet, so those are recorded but not actually sent.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               userIds: { type: array, items: { type: integer } }
 *               toAllUsers: { type: boolean, default: false }
 *               templateCode: { type: string }
 *               title: { type: string }
 *               message: { type: string }
 *               channel: { $ref: '#/components/schemas/NotificationChannel' }
 *               variables: { type: object }
 *               actions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     label: { type: string }
 *                     url: { type: string }
 *     responses:
 *       200:
 *         description: Sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/send',
  validate(schemas.sendSystemSchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_SEND),
  controller.sendSystem
);

/**
 * @openapi
 * /api/v1/notifications/templates/list:
 *   post:
 *     tags: [Notifications]
 *     summary: List notification templates
 *     description: 'Requires permission: `NOTIFICATION_TEMPLATE_MANAGE`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   channel: { $ref: '#/components/schemas/NotificationChannel' }
 *     responses:
 *       200:
 *         description: Templates
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/templates/list',
  validate(schemas.listTemplatesSchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_TEMPLATE_MANAGE),
  controller.listTemplates
);

/**
 * @openapi
 * /api/v1/notifications/templates/save:
 *   post:
 *     tags: [Notifications]
 *     summary: Create or update a template
 *     description: |
 *       Requires permission: `NOTIFICATION_TEMPLATE_MANAGE`. Upsert keyed on
 *       (`code`, `channel`). Use `{{placeholder}}` in the subject and body;
 *       placeholders are substituted from the variables passed at send time.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, channel, body]
 *             properties:
 *               code: { type: string, example: ORDER_CONFIRMED }
 *               channel: { $ref: '#/components/schemas/NotificationChannel' }
 *               subject: { type: string, example: "Order {{orderNumber}} confirmed" }
 *               body: { type: string, example: "Hi {{customerName}}, your order is confirmed." }
 *               variables: { type: array, items: { type: string } }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Template saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/templates/save',
  validate(schemas.saveTemplateSchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_TEMPLATE_MANAGE),
  controller.saveTemplate
);

/**
 * @openapi
 * /api/v1/notifications/templates/preview:
 *   post:
 *     tags: [Notifications]
 *     summary: Render a template without sending it
 *     description: 'Requires permission: `NOTIFICATION_TEMPLATE_MANAGE`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               variables:
 *                 type: object
 *                 example: { orderNumber: "BB-260826-K7X2QM", customerName: "Ravi" }
 *     responses:
 *       200:
 *         description: Rendered template
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/templates/preview',
  validate(schemas.previewTemplateSchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_TEMPLATE_MANAGE),
  controller.previewTemplate
);

/**
 * @openapi
 * /api/v1/notifications/templates/delete:
 *   post:
 *     tags: [Notifications]
 *     summary: Delete a template
 *     description: |
 *       Requires permission: `NOTIFICATION_TEMPLATE_MANAGE`. Soft delete. Sends
 *       that reference a missing template fall back to the literal title and
 *       message supplied by the caller.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/templates/delete',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.NOTIFICATION_TEMPLATE_MANAGE),
  controller.deleteTemplate
);

module.exports = router;
