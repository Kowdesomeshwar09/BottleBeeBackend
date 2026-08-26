'use strict';

const express = require('express');

const controller = require('../../controllers/promotion.controller');
const validate = require('../../middlewares/validate');
const { authenticate, optionalAuthenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/promotion.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/promotions/active:
 *   post:
 *     tags: [Promotions]
 *     summary: Live banners for the storefront
 *     description: |
 *       Public. Promotions inside their live window, ordered for display. Each
 *       banner's polymorphic target (category, product or store) is resolved and
 *       returned inline, so the client needs no follow-up request per banner.
 *
 *       Banners are presentation only — they carry no discount and cannot change
 *       an order total. Anything affecting price is a coupon.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Active promotions
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/active', validate(schemas.emptySchema), optionalAuthenticate, controller.active);

/**
 * @openapi
 * /api/v1/promotions/list:
 *   post:
 *     tags: [Promotions]
 *     summary: List promotions
 *     description: 'Requires permission: `PROMOTION_MANAGE`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/CouponStatus' }
 *                   targetType: { $ref: '#/components/schemas/PromotionTargetType' }
 *                   activeNow: { type: boolean }
 *     responses:
 *       200:
 *         description: Promotions
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/list',
  validate(schemas.listPromotionsSchema),
  authenticate,
  authorize(PERMISSIONS.PROMOTION_MANAGE),
  controller.list
);

/**
 * @openapi
 * /api/v1/promotions/save:
 *   post:
 *     tags: [Promotions]
 *     summary: Create or update a promotional banner
 *     description: |
 *       Requires permission: `PROMOTION_MANAGE`. Pass `id` to update.
 *       `targetId` is required for every `targetType` except `ALL`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, startsAt, endsAt]
 *             properties:
 *               id: { type: integer }
 *               title: { type: string, example: Weekend Whisky Festival }
 *               description: { type: string }
 *               bannerUrl: { type: string }
 *               targetType: { $ref: '#/components/schemas/PromotionTargetType' }
 *               targetId: { type: integer, nullable: true }
 *               sortOrder: { type: integer }
 *               startsAt: { type: string, format: date-time }
 *               endsAt: { type: string, format: date-time }
 *               status: { $ref: '#/components/schemas/CouponStatus' }
 *     responses:
 *       200:
 *         description: Saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/save',
  validate(schemas.savePromotionSchema),
  authenticate,
  authorize(PERMISSIONS.PROMOTION_MANAGE),
  controller.save
);

/**
 * @openapi
 * /api/v1/promotions/delete:
 *   post:
 *     tags: [Promotions]
 *     summary: Delete a promotion
 *     description: 'Requires permission: `PROMOTION_MANAGE`. Soft delete.'
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
  '/delete',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.PROMOTION_MANAGE),
  controller.remove
);

/**
 * @openapi
 * /api/v1/promotions/expire-lapsed:
 *   post:
 *     tags: [Promotions]
 *     summary: Mark promotions past their end date as expired
 *     description: 'Requires permission: `PROMOTION_MANAGE`. Intended for a scheduled job.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Expired
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/expire-lapsed',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.PROMOTION_MANAGE),
  controller.expireLapsed
);

module.exports = router;
