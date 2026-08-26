'use strict';

const express = require('express');

const controller = require('../../controllers/order.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { checkoutLimiter } = require('../../middlewares/rateLimiters');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/order.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/orders/checkout:
 *   post:
 *     tags: [Orders]
 *     summary: Turn your cart into an order
 *     description: |
 *       Requires permission: `ORDER_PLACE`. Rate limited.
 *
 *       One transaction, thirteen ordered gates, all evaluated from the server's
 *       own data — the client supplies no items, prices, discounts or totals:
 *
 *       1. you have a customer profile
 *       2. your cart is not empty
 *       3. every item belongs to one store (single-vendor by licensing)
 *       4. the delivery address is yours
 *       5. every item is still purchasable
 *       6. totals are recomputed server-side
 *       7. the store's minimum order value is met
 *       8. regional compliance passes — age, verification, dry day, sale window, caps
 *       9. the store is approved and licensed for the delivery region
 *       10. the order and its items are written
 *       11. stock is reserved atomically; a losing race aborts the checkout
 *       12. the coupon is redeemed within its usage limit
 *       13. your cart is consumed only once the order exists
 *
 *       Any failure rolls everything back, so a rejected checkout never leaves
 *       stock reserved or a coupon burnt.
 *
 *       `paymentMethod: CASH` confirms immediately and collects on delivery.
 *       Anything else lands in `PAYMENT_PENDING` awaiting the payment module.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deliveryAddressId:
 *                 type: integer
 *                 description: Defaults to your default address.
 *               paymentMethod: { $ref: '#/components/schemas/PaymentProvider' }
 *               customerNotes: { type: string, example: Please ring the doorbell twice }
 *     responses:
 *       201:
 *         description: Order placed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403:
 *         description: Blocked by compliance or an invalid store licence
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Empty cart, mixed stores, out of stock, or below the store minimum
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/checkout',
  checkoutLimiter,
  validate(schemas.checkoutSchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_PLACE),
  controller.checkout
);

/**
 * @openapi
 * /api/v1/orders/list:
 *   post:
 *     tags: [Orders]
 *     summary: List orders
 *     description: |
 *       Requires permission: `ORDER_VIEW`. Automatically scoped to the caller: a
 *       customer sees their own orders, a vendor user their stores', a delivery
 *       partner the ones assigned to them, and staff everything.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status:
 *                     oneOf:
 *                       - $ref: '#/components/schemas/OrderStatus'
 *                       - type: array
 *                         items: { $ref: '#/components/schemas/OrderStatus' }
 *                   paymentStatus: { $ref: '#/components/schemas/OrderPaymentStatus' }
 *                   deliveryStatus: { $ref: '#/components/schemas/OrderDeliveryStatus' }
 *                   orderNumber: { type: string, example: BB-260826-K7X2QM }
 *                   vendorId: { type: integer }
 *                   customerId: { type: integer }
 *                   fromDate: { type: string, format: date-time }
 *                   toDate: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Orders
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/list',
  validate(schemas.listOrdersSchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_VIEW),
  controller.list
);

/**
 * @openapi
 * /api/v1/orders/detail:
 *   post:
 *     tags: [Orders]
 *     summary: Full order with items, payments, refunds, delivery and history
 *     description: |
 *       Requires permission: `ORDER_VIEW`, plus a relationship to the order —
 *       being its customer, a member of its store, or its assigned delivery
 *       partner. Staff may read any order.
 *
 *       The delivery partner's phone number is included only while the delivery
 *       is actually in progress.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Order
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/detail',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_VIEW),
  controller.detail
);

/**
 * @openapi
 * /api/v1/orders/track:
 *   post:
 *     tags: [Orders]
 *     summary: Track an order by id or order number
 *     description: |
 *       Requires permission: `ORDER_VIEW`. A lighter payload than `/detail`,
 *       shaped for a tracking screen. Access control is identical.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: integer }
 *               orderNumber: { type: string, example: BB-260826-K7X2QM }
 *     responses:
 *       200:
 *         description: Tracking detail
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/track',
  validate(schemas.trackSchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_VIEW),
  controller.track
);

/**
 * @openapi
 * /api/v1/orders/status-history:
 *   post:
 *     tags: [Orders]
 *     summary: Paginated status history for an order
 *     description: 'Requires permission: `ORDER_VIEW`. Every transition, who made it and when.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - $ref: '#/components/schemas/IdRequest'
 *     responses:
 *       200:
 *         description: History
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/status-history',
  validate(schemas.historySchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_VIEW),
  controller.statusHistory
);

/**
 * @openapi
 * /api/v1/orders/update-status:
 *   post:
 *     tags: [Orders]
 *     summary: Advance an order to the next status
 *     description: |
 *       Requires permission: `ORDER_MANAGE`.
 *
 *       Only transitions allowed by the order state machine are accepted, and
 *       each transition also checks that the caller's role is permitted to drive
 *       it — a vendor can confirm and prepare, a delivery partner can pick up and
 *       deliver. `allowedNextStatuses` on any order response lists what is
 *       currently possible.
 *
 *       Side effects happen in the same transaction as the status change:
 *       moving to DELIVERED converts reserved stock into a sale and settles a
 *       cash order; moving to CANCELLED releases reserved stock and returns any
 *       coupon. DELIVERED is refused until the delivery partner has confirmed the
 *       recipient's age and identity.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { $ref: '#/components/schemas/OrderStatus' }
 *               reason: { type: string, description: Required when cancelling. }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Your role may not make this transition, or the recipient is unverified
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Illegal transition; `errors[0].allowed` lists what is possible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/update-status',
  validate(schemas.updateStatusSchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_MANAGE),
  controller.updateStatus
);

/**
 * @openapi
 * /api/v1/orders/cancel:
 *   post:
 *     tags: [Orders]
 *     summary: Cancel an order
 *     description: |
 *       Requires permission: `ORDER_CANCEL`.
 *
 *       A customer may cancel before the store starts preparing, and for
 *       CANCELLATION_WINDOW_MINUTES after confirmation. Staff are not bound by
 *       that window. Reserved stock is released and any coupon returned, both in
 *       the same transaction as the cancellation.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, reason]
 *             properties:
 *               id: { type: integer }
 *               reason: { type: string, example: Ordered by mistake }
 *     responses:
 *       200:
 *         description: Order cancelled
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Too late to cancel, or the order is already in a terminal state
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/cancel',
  validate(schemas.cancelSchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_CANCEL),
  controller.cancel
);

/**
 * @openapi
 * /api/v1/orders/summary:
 *   post:
 *     tags: [Orders]
 *     summary: Sales and fulfilment summary
 *     description: |
 *       Requires permission: `ORDER_VIEW`. Order count, delivered count, revenue
 *       from delivered orders, average order value, a per-status breakdown and
 *       the cancellation rate. Scoped to the caller exactly like `/list`.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vendorId: { type: integer }
 *               customerId: { type: integer }
 *               fromDate: { type: string, format: date-time }
 *               toDate: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Summary
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/summary',
  validate(schemas.summarySchema),
  authenticate,
  authorize(PERMISSIONS.ORDER_VIEW),
  controller.summary
);

module.exports = router;
