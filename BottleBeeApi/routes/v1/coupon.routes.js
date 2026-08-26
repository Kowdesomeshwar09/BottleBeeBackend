'use strict';

const express = require('express');

const controller = require('../../controllers/coupon.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/promotion.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/coupons/available:
 *   post:
 *     tags: [Promotions]
 *     summary: Coupons you can use right now
 *     description: |
 *       Requires permission: `CART_MANAGE`. Returns platform-wide coupons plus any
 *       scoped to the given store, each annotated with whether it currently
 *       applies to the supplied subtotal, the discount it would give, and how
 *       much more would need to be spent if it does not yet qualify.
 *
 *       Advisory only — the discount is recomputed server-side at checkout.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subtotal: { type: number, example: 2400 }
 *               vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Applicable coupons
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/available',
  validate(schemas.availableCouponsSchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.available
);

/**
 * @openapi
 * /api/v1/coupons/list:
 *   post:
 *     tags: [Promotions]
 *     summary: List coupons
 *     description: 'Requires permission: `COUPON_MANAGE`. Set `activeNow` to list only coupons inside their live window.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/CouponStatus' }
 *                   vendorId: { type: integer }
 *                   discountType: { $ref: '#/components/schemas/DiscountType' }
 *                   activeNow: { type: boolean }
 *     responses:
 *       200:
 *         description: Coupons
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/list',
  validate(schemas.listCouponsSchema),
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  controller.list
);

/**
 * @openapi
 * /api/v1/coupons/detail:
 *   post:
 *     tags: [Promotions]
 *     summary: Get one coupon with its redemption count
 *     description: 'Requires permission: `COUPON_MANAGE`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Coupon
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/detail',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  controller.detail
);

/**
 * @openapi
 * /api/v1/coupons/create:
 *   post:
 *     tags: [Promotions]
 *     summary: Create a coupon
 *     description: |
 *       Requires permission: `COUPON_MANAGE`.
 *       `PERCENTAGE` coupons are capped at 100 and may carry a
 *       `maxDiscountAmount` ceiling. A discount can reduce an order to zero but
 *       never below it. Omit `vendorId` for a platform-wide coupon.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, title, discountType, discountValue, startsAt, endsAt]
 *             properties:
 *               code: { type: string, example: CHEERS20 }
 *               title: { type: string, example: 20% off your first order }
 *               description: { type: string }
 *               discountType: { $ref: '#/components/schemas/DiscountType' }
 *               discountValue: { type: number, example: 20 }
 *               maxDiscountAmount: { type: number, example: 500 }
 *               minOrderAmount: { type: number, example: 1000 }
 *               usageLimit: { type: integer, example: 1000 }
 *               usageLimitPerUser: { type: integer, example: 1 }
 *               vendorId: { type: integer, nullable: true }
 *               startsAt: { type: string, format: date-time }
 *               endsAt: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/create',
  validate(schemas.createCouponSchema),
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  controller.create
);

/**
 * @openapi
 * /api/v1/coupons/update:
 *   post:
 *     tags: [Promotions]
 *     summary: Update a coupon
 *     description: |
 *       Requires permission: `COUPON_MANAGE`. The usage limit cannot be lowered
 *       below the number of redemptions already recorded, or the history would
 *       no longer reconcile against the orders that consumed it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               title: { type: string }
 *               discountValue: { type: number }
 *               maxDiscountAmount: { type: number }
 *               minOrderAmount: { type: number }
 *               usageLimit: { type: integer }
 *               endsAt: { type: string, format: date-time }
 *               status: { $ref: '#/components/schemas/CouponStatus' }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/update',
  validate(schemas.updateCouponSchema),
  authenticate,
  authorize(PERMISSIONS.COUPON_MANAGE),
  controller.update
);

/**
 * @openapi
 * /api/v1/coupons/delete:
 *   post:
 *     tags: [Promotions]
 *     summary: Deactivate a coupon
 *     description: |
 *       Requires permission: `COUPON_MANAGE`. Soft delete — redemption history is
 *       retained so past orders stay reconcilable.
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
  authorize(PERMISSIONS.COUPON_MANAGE),
  controller.remove
);

/**
 * @openapi
 * /api/v1/coupons/expire-lapsed:
 *   post:
 *     tags: [Promotions]
 *     summary: Mark coupons past their end date as expired
 *     description: 'Requires permission: `COUPON_MANAGE`. Intended for a scheduled job; exposed for on-demand runs.'
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
  authorize(PERMISSIONS.COUPON_MANAGE),
  controller.expireLapsed
);

module.exports = router;
