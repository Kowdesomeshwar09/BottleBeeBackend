'use strict';

const express = require('express');

const controller = require('../../controllers/compliance.controller');
const validate = require('../../middlewares/validate');
const { authenticate, optionalAuthenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/compliance.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/compliance/serviceability:
 *   post:
 *     tags: [Compliance]
 *     summary: Can Bottle Bee deliver to this location right now?
 *     description: |
 *       Public. Supply a region code, a state or a postal code and the response
 *       reports the governing region, the legal drinking age, whether today is a
 *       dry day, the permitted sale window and the per-order caps.
 *
 *       Used by the storefront to explain a blocker before the customer reaches
 *       checkout. It is advisory only — checkout re-evaluates every rule server-side.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               regionCode: { type: string, example: IN-TS }
 *               state: { type: string, example: Telangana }
 *               city: { type: string, example: Hyderabad }
 *               postalCode: { type: string, example: "500081" }
 *     responses:
 *       200:
 *         description: Serviceability report
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/serviceability',
  optionalAuthenticate,
  validate(schemas.serviceabilitySchema),
  controller.serviceability
);

router.use(authenticate);

/**
 * @openapi
 * /api/v1/compliance/rules/list:
 *   post:
 *     tags: [Compliance]
 *     summary: List regional compliance rules
 *     description: 'Requires permission: `COMPLIANCE_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   dryDay: { type: boolean }
 *     responses:
 *       200:
 *         description: Rules
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/rules/list',
  authorize(PERMISSIONS.COMPLIANCE_VIEW),
  validate(schemas.listRulesSchema),
  controller.list
);

/**
 * @openapi
 * /api/v1/compliance/rules/detail:
 *   post:
 *     tags: [Compliance]
 *     summary: Get one rule by id or region code
 *     description: 'Requires permission: `COMPLIANCE_VIEW`. Supply either `id` or `regionCode`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: integer }
 *               regionCode: { type: string, example: IN-KA }
 *     responses:
 *       200:
 *         description: Rule
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/rules/detail',
  authorize(PERMISSIONS.COMPLIANCE_VIEW),
  validate(schemas.detailSchema),
  controller.detail
);

/**
 * @openapi
 * /api/v1/compliance/rules/save:
 *   post:
 *     tags: [Compliance]
 *     summary: Create or update a regional rule
 *     description: |
 *       Requires permission: `COMPLIANCE_MANAGE`. Upsert keyed on `regionCode`.
 *
 *       `ruleMetadata` carries the optional extras the compliance engine honours:
 *       `states` maps address states to this region, `dryDates` lists specific
 *       prohibition dates, `blockedTypes` bars particular product types.
 *
 *       Every change is written to the audit log.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [regionCode]
 *             properties:
 *               regionCode: { type: string, example: IN-TS }
 *               regionName: { type: string, example: Telangana }
 *               minimumAge: { type: integer, example: 21 }
 *               alcoholSaleStartTime: { type: string, example: "10:00:00" }
 *               alcoholSaleEndTime: { type: string, example: "23:00:00" }
 *               dryDay: { type: boolean }
 *               maxOrderAmount: { type: number, example: 25000 }
 *               maxQuantityPerOrder: { type: integer, example: 12 }
 *               ruleMetadata:
 *                 type: object
 *                 properties:
 *                   states: { type: array, items: { type: string } }
 *                   dryDates: { type: array, items: { type: string, format: date } }
 *                   blockedTypes: { type: array, items: { type: string } }
 *                   note: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Rule saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/rules/save',
  authorize(PERMISSIONS.COMPLIANCE_MANAGE),
  validate(schemas.upsertRuleSchema),
  controller.save
);

/**
 * @openapi
 * /api/v1/compliance/rules/delete:
 *   post:
 *     tags: [Compliance]
 *     summary: Remove a regional rule
 *     description: |
 *       Requires permission: `COMPLIANCE_MANAGE`. Soft delete. Addresses in a
 *       region with no rule fall back to the conservative platform default
 *       (DEFAULT_MINIMUM_AGE, no sale window), so deleting a rule never makes a
 *       region more permissive by accident.
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
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/rules/delete',
  authorize(PERMISSIONS.COMPLIANCE_MANAGE),
  validate(schemas.idSchema),
  controller.remove
);

module.exports = router;
