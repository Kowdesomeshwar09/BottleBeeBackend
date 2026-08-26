'use strict';

const express = require('express');

const controller = require('../../controllers/cart.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/cart.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/cart/detail:
 *   post:
 *     tags: [Cart]
 *     summary: Get your cart with live totals
 *     description: |
 *       Requires permission: `CART_MANAGE`.
 *
 *       Totals are recomputed from the catalog on every read, so a price change
 *       or a stock movement is reflected before the customer reaches payment.
 *       `warnings` lists anything that would block checkout — an unavailable
 *       product, insufficient stock, a suspended store — and `couponError`
 *       explains an applied coupon that has since stopped qualifying.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Cart
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404:
 *         description: No customer profile exists for this account
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/detail',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.detail
);

/**
 * @openapi
 * /api/v1/cart/add-item:
 *   post:
 *     tags: [Cart]
 *     summary: Add an item to the cart
 *     description: |
 *       Requires permission: `CART_MANAGE`.
 *
 *       The cart is single-vendor: Bottle Bee delivers from one licensed store
 *       per order, so the first item pins the store and an item from a different
 *       store is refused with 409 `MIXED_VENDOR_CART` until the cart is cleared.
 *
 *       Adding a variant already in the cart increases its quantity. Stock is
 *       checked against the combined quantity, not just the increment. Nothing is
 *       reserved at this point — reservation happens at checkout.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productVariantId]
 *             properties:
 *               productVariantId: { type: integer }
 *               quantity: { type: integer, default: 1, example: 2 }
 *     responses:
 *       200:
 *         description: Item added; the full cart is returned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Out of stock, unavailable product, or a mixed-vendor cart
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/add-item',
  validate(schemas.addItemSchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.addItem
);

/**
 * @openapi
 * /api/v1/cart/update-item:
 *   post:
 *     tags: [Cart]
 *     summary: Change an item's quantity
 *     description: 'Requires permission: `CART_MANAGE`. `id` is the cart item id, not the variant id.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, quantity]
 *             properties:
 *               id: { type: integer, description: Cart item id. }
 *               quantity: { type: integer, example: 3 }
 *     responses:
 *       200:
 *         description: Cart updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/update-item',
  validate(schemas.updateItemSchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.updateItem
);

/**
 * @openapi
 * /api/v1/cart/remove-item:
 *   post:
 *     tags: [Cart]
 *     summary: Remove an item
 *     description: |
 *       Requires permission: `CART_MANAGE`. Removing the last item releases the
 *       store pin and any coupon, so the customer can shop elsewhere without
 *       clearing the cart explicitly.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Item removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/remove-item',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.removeItem
);

/**
 * @openapi
 * /api/v1/cart/clear:
 *   post:
 *     tags: [Cart]
 *     summary: Empty the cart
 *     description: 'Requires permission: `CART_MANAGE`. Also clears the store pin and any applied coupon.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Cart cleared
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/clear',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.clear
);

/**
 * @openapi
 * /api/v1/cart/apply-coupon:
 *   post:
 *     tags: [Cart]
 *     summary: Apply a coupon code
 *     description: |
 *       Requires permission: `CART_MANAGE`. Only the code is sent; the discount is
 *       computed server-side from the coupon record.
 *
 *       Rejection carries a specific reason code — `COUPON_EXPIRED`,
 *       `COUPON_MIN_ORDER_NOT_MET`, `COUPON_WRONG_VENDOR`,
 *       `COUPON_USER_LIMIT_REACHED`, `COUPON_LIMIT_REACHED` — so the UI can
 *       explain the problem rather than saying "invalid".
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [couponCode]
 *             properties:
 *               couponCode: { type: string, example: CHEERS20 }
 *     responses:
 *       200:
 *         description: Coupon applied
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: The coupon does not apply; `errors[0].code` says why
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/apply-coupon',
  validate(schemas.applyCouponSchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.applyCoupon
);

/**
 * @openapi
 * /api/v1/cart/remove-coupon:
 *   post:
 *     tags: [Cart]
 *     summary: Remove the applied coupon
 *     description: 'Requires permission: `CART_MANAGE`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Coupon removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/remove-coupon',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.removeCoupon
);

/**
 * @openapi
 * /api/v1/cart/validate-checkout:
 *   post:
 *     tags: [Cart]
 *     summary: Is this cart ready to check out?
 *     description: |
 *       Requires permission: `CART_MANAGE`.
 *
 *       Runs the same gates checkout will run — stock availability, store licence
 *       for the delivery region, age verification, regional compliance and the
 *       store's minimum order value — but returns them all as a list instead of
 *       failing on the first, so the customer sees every blocker at once.
 *
 *       Advisory. Checkout re-runs every check inside its transaction.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deliveryAddressId:
 *                 type: integer
 *                 description: Defaults to your default address.
 *     responses:
 *       200:
 *         description: Readiness report with `ready`, `blockers` and `compliance`
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/validate-checkout',
  validate(schemas.validateForCheckoutSchema),
  authenticate,
  authorize(PERMISSIONS.CART_MANAGE),
  controller.validateForCheckout
);

/**
 * @openapi
 * /api/v1/cart/expire-stale:
 *   post:
 *     tags: [Cart]
 *     summary: Mark untouched carts abandoned
 *     description: |
 *       Requires permission: `ORDER_MANAGE`. Carts idle longer than
 *       CART_EXPIRY_HOURS become ABANDONED. Intended for a scheduled job.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Stale carts abandoned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/expire-stale',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_MANAGE),
  controller.expireStale
);

module.exports = router;
