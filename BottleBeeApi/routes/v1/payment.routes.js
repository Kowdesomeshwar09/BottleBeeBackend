'use strict';

const express = require('express');

const controller = require('../../controllers/payment.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { checkoutLimiter } = require('../../middlewares/rateLimiters');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/payment.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Provider payment webhook
 *     description: |
 *       Unauthenticated by necessity — the provider holds no token — so the HMAC
 *       signature over the **raw** request body is the entire security boundary.
 *       `app.js` captures that raw body before JSON parsing for this route only.
 *       Send it as `X-Razorpay-Signature`.
 *
 *       This is the authoritative payment signal: a capture here confirms the
 *       order even if the browser never came back from the payment page.
 *
 *       Idempotent. `(transaction_type, provider_reference)` is unique on
 *       payment_transactions, so a provider retrying the same event — which they
 *       all do — is absorbed rather than double-applied.
 *
 *       Always answers 200 once the signature is valid, including on internal
 *       failure: a 5xx would make the provider retry a payload already recorded.
 *       An invalid signature is 400.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: The provider's event payload, passed through verbatim.
 *     responses:
 *       200:
 *         description: Webhook received; `data.handled` says whether it changed anything
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Invalid or missing signature
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/webhook', controller.webhook);

/**
 * @openapi
 * /api/v1/payments/create-intent:
 *   post:
 *     tags: [Payments]
 *     summary: Start a payment for an order
 *     description: |
 *       Requires permission: `PAYMENT_MANAGE`. Rate limited.
 *
 *       Opens a provider order for the amount recorded on the order at checkout.
 *       No amount is accepted from the client, so a tampered figure has nowhere
 *       to enter.
 *
 *       Re-callable: an abandoned attempt returns the existing intent rather than
 *       orphaning one at the provider. The response carries the publishable key
 *       the client needs to open the provider's checkout.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId]
 *             properties:
 *               orderId: { type: integer }
 *     responses:
 *       201:
 *         description: Intent created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: The order is not awaiting payment, or is already paid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/create-intent',
  checkoutLimiter,
  validate(schemas.createIntentSchema),
  authenticate,
  authorize(PERMISSIONS.PAYMENT_MANAGE),
  controller.createIntent
);

/**
 * @openapi
 * /api/v1/payments/confirm:
 *   post:
 *     tags: [Payments]
 *     summary: Confirm a payment after the provider handshake
 *     description: |
 *       Requires permission: `PAYMENT_MANAGE`.
 *
 *       `signature` must be the provider's HMAC over
 *       `providerOrderId|providerPaymentId`. It is what proves the payment id
 *       genuinely belongs to this order rather than being invented — without it,
 *       knowing an order id would be enough to mark it paid.
 *
 *       On success the payment is captured and the order advances to CONFIRMED in
 *       the same transaction, so an order can never read as paid while its
 *       payment row disagrees. Calling it twice is safe.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [providerOrderId, providerPaymentId, signature]
 *             properties:
 *               providerOrderId: { type: string, example: order_QmT4xR9kLpZ2aB }
 *               providerPaymentId: { type: string, example: pay_QmT53bV8nQx1cD }
 *               signature: { type: string }
 *     responses:
 *       200:
 *         description: Payment confirmed; the updated order is returned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401:
 *         description: Signature verification failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/confirm',
  validate(schemas.confirmSchema),
  authenticate,
  authorize(PERMISSIONS.PAYMENT_MANAGE),
  controller.confirm
);

/**
 * @openapi
 * /api/v1/payments/mark-failed:
 *   post:
 *     tags: [Payments]
 *     summary: Report an abandoned or declined attempt
 *     description: |
 *       Requires permission: `PAYMENT_MANAGE`. Advisory — it cannot mark anything
 *       paid, and reserved stock is deliberately kept so the customer can retry
 *       without losing their order. The provider webhook remains authoritative.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [providerOrderId]
 *             properties:
 *               providerOrderId: { type: string }
 *               providerPaymentId: { type: string }
 *               reason: { type: string, example: Card declined }
 *     responses:
 *       200:
 *         description: Failure recorded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: The payment was already captured
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/mark-failed',
  validate(schemas.markFailedSchema),
  authenticate,
  authorize(PERMISSIONS.PAYMENT_MANAGE),
  controller.markFailed
);

/**
 * @openapi
 * /api/v1/payments/list:
 *   post:
 *     tags: [Payments]
 *     summary: List payments
 *     description: |
 *       Requires permission: `PAYMENT_VIEW`. Scoped through the orders the caller
 *       may see, so a customer sees only their own payments.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   orderId: { type: integer }
 *                   status: { $ref: '#/components/schemas/PaymentStatus' }
 *                   vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Payments
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/list',
  validate(schemas.listPaymentsSchema),
  authenticate,
  authorize(PERMISSIONS.PAYMENT_VIEW),
  controller.list
);

/**
 * @openapi
 * /api/v1/payments/detail:
 *   post:
 *     tags: [Payments]
 *     summary: One payment with its provider transaction trail
 *     description: 'Requires permission: `PAYMENT_VIEW`, plus access to the order it belongs to.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Payment
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
  authorize(PERMISSIONS.PAYMENT_VIEW),
  controller.detail
);

/**
 * @openapi
 * /api/v1/payments/refunds/request:
 *   post:
 *     tags: [Payments]
 *     summary: Request a refund
 *     description: |
 *       Requires permission: `REFUND_REQUEST`. Customers and support agents may
 *       raise one. Omit `amount` to request everything still refundable.
 *
 *       Only one refund may be in progress per order at a time, and the amount
 *       cannot exceed what remains refundable on the captured payment.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, reason]
 *             properties:
 *               orderId: { type: integer }
 *               amount: { type: number, description: Defaults to the full refundable balance. }
 *               reason: { type: string, example: Two bottles arrived damaged }
 *     responses:
 *       201:
 *         description: Refund requested
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Nothing captured to refund, a refund is already in progress, or the amount exceeds the balance
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/refunds/request',
  validate(schemas.requestRefundSchema),
  authenticate,
  authorize(PERMISSIONS.REFUND_REQUEST),
  controller.requestRefund
);

/**
 * @openapi
 * /api/v1/payments/refunds/review:
 *   post:
 *     tags: [Payments]
 *     summary: Approve or reject a refund
 *     description: |
 *       Requires permission: `REFUND_MANAGE`.
 *
 *       Approving calls the provider immediately. Once it settles, the payment
 *       and order are marked refunded and, for a **delivered** order that is
 *       fully refunded, the goods go back into stock. A cancelled order's stock
 *       was already released at cancellation, so it is deliberately not returned
 *       twice — that would invent inventory.
 *
 *       A provider failure leaves the refund FAILED with the reason recorded,
 *       rather than silently disappearing.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { type: string, enum: [APPROVED, REJECTED] }
 *               rejectionReason: { type: string }
 *     responses:
 *       200:
 *         description: Refund reviewed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       502:
 *         description: The provider rejected the refund
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/refunds/review',
  validate(schemas.reviewRefundSchema),
  authenticate,
  authorize(PERMISSIONS.REFUND_MANAGE),
  controller.reviewRefund
);

/**
 * @openapi
 * /api/v1/payments/refunds/list:
 *   post:
 *     tags: [Payments]
 *     summary: List refunds
 *     description: 'Requires permission: `PAYMENT_VIEW`. Scoped like `/payments/list`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   orderId: { type: integer }
 *                   status: { $ref: '#/components/schemas/RefundStatus' }
 *     responses:
 *       200:
 *         description: Refunds
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/refunds/list',
  validate(schemas.listRefundsSchema),
  authenticate,
  authorize(PERMISSIONS.PAYMENT_VIEW),
  controller.listRefunds
);

module.exports = router;
