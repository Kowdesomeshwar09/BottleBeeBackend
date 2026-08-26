'use strict';

const express = require('express');

const controller = require('../../controllers/admin.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/admin.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/admin/dashboard:
 *   post:
 *     tags: [Admin]
 *     summary: Platform dashboard
 *     description: |
 *       Requires permission: `REPORT_VIEW`.
 *
 *       Users, stores, catalog, orders, revenue, delivery and inventory across
 *       the window, which defaults to the last 30 days.
 *
 *       The part that matters operationally is `actionQueue`: the counts
 *       currently waiting on a human — age verifications, vendor licences and
 *       applications, product approvals, reviews, refunds — plus licences
 *       expiring within 30 days, since a store loses the right to sell the day
 *       one lapses.
 *
 *       Every figure is derived at query time, so nothing here can drift from the
 *       tables it describes.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromDate: { type: string, format: date-time }
 *               toDate: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Dashboard
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/dashboard',
  validate(schemas.windowSchema),
  authenticate,
  authorize(PERMISSIONS.REPORT_VIEW),
  controller.dashboard
);

/**
 * @openapi
 * /api/v1/admin/reports/sales:
 *   post:
 *     tags: [Admin]
 *     summary: Sales report
 *     description: |
 *       Requires permission: `REPORT_VIEW`. Revenue from delivered orders,
 *       broken down by day and by store, with discounts, tax and delivery fees
 *       separated out. Pass `vendorId` to scope it to one store.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromDate: { type: string, format: date-time }
 *               toDate: { type: string, format: date-time }
 *               vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Sales report
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/reports/sales',
  validate(schemas.salesReportSchema),
  authenticate,
  authorize(PERMISSIONS.REPORT_VIEW),
  controller.salesReport
);

/**
 * @openapi
 * /api/v1/admin/reports/compliance:
 *   post:
 *     tags: [Admin]
 *     summary: Compliance report
 *     description: |
 *       Requires permission: `COMPLIANCE_VIEW`. The report a regulator would ask
 *       for.
 *
 *       Two figures deserve attention. `vendorLicences.expiredButApproved` should
 *       always be zero — anything else is a store trading without cover. And
 *       `recipientVerification.coveragePercent` should always be 100: anything
 *       less is a delivery that completed without the age check at the door, and
 *       needs investigating.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fromDate: { type: string, format: date-time }
 *               toDate: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Compliance report
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/reports/compliance',
  validate(schemas.windowSchema),
  authenticate,
  authorize(PERMISSIONS.COMPLIANCE_VIEW),
  controller.complianceReport
);

/**
 * @openapi
 * /api/v1/admin/audit-logs:
 *   post:
 *     tags: [Admin]
 *     summary: Search the audit log
 *     description: |
 *       Requires permission: `AUDIT_VIEW`. Every sensitive operation is recorded
 *       here: logins and failures, token replay, password resets, role and
 *       permission changes, age-verification and licence reviews, order
 *       transitions, payments, refunds and recipient verification.
 *
 *       Sensitive attributes are redacted at write time, so password hashes,
 *       tokens and document numbers never appear in the trail.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   action: { type: string, example: LOGIN_FAILED }
 *                   entityType: { type: string, example: Order }
 *                   entityId: { type: integer }
 *                   actorUserId: { type: integer }
 *                   ipAddress: { type: string }
 *                   fromDate: { type: string, format: date-time }
 *                   toDate: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Audit log entries
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/audit-logs',
  validate(schemas.auditLogsSchema),
  authenticate,
  authorize(PERMISSIONS.AUDIT_VIEW),
  controller.auditLogs
);

/**
 * @openapi
 * /api/v1/admin/audit-trail:
 *   post:
 *     tags: [Admin]
 *     summary: Everything that happened to one record
 *     description: |
 *       Requires permission: `AUDIT_VIEW`. The "who changed this, and when?"
 *       view for a single entity, oldest first.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entityType, entityId]
 *             properties:
 *               entityType: { type: string, example: Order }
 *               entityId: { type: integer, example: 1 }
 *     responses:
 *       200:
 *         description: Audit trail
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/audit-trail',
  validate(schemas.entityTrailSchema),
  authenticate,
  authorize(PERMISSIONS.AUDIT_VIEW),
  controller.entityTrail
);

module.exports = router;
