'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const logger = require('../config/logger');
const {
  sequelize, Order, Payment, PaymentTransaction, Refund, CustomerProfile, Vendor,
} = require('../models');
const {
  ORDER_STATUS, ORDER_PAYMENT_STATUS, PAYMENT_STATUS, PAYMENT_TRANSACTION_TYPE,
  PAYMENT_PROVIDER, REFUND_STATUS, ROLES, AUDIT_ACTIONS,
} = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const money = require('../utils/money');
const {
  ok, created, paginated, updated, fail,
} = require('../utils/response');
const paymentService = require('../services/payment.service');
const orderService = require('../services/order.service');
const inventoryService = require('../services/inventory.service');
const notificationService = require('../services/notification.service');
const vendorAccessService = require('../services/vendorAccess.service');

/**
 * Payments and refunds.
 *
 * The amount charged is never taken from the client. A payment intent is always
 * created for `order.grandTotal` as computed at checkout, and confirmation
 * re-reads that figure rather than trusting whatever the browser posts back.
 *
 * Confirmation requires a provider signature over `orderId|paymentId`. Without
 * it, anyone who knew an order id could mark it paid.
 *
 * Webhooks are idempotent by construction: `(transaction_type,
 * provider_reference)` is unique on payment_transactions, so a provider
 * retrying the same event — which they all do — cannot double-apply it.
 */

const SORTABLE = ['id', 'amount', 'status', 'paidAt', 'createdAt'];
const REFUND_SORTABLE = ['id', 'amount', 'status', 'processedAt', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serializePayment = (payment, extra = {}) => ({
  id: payment.id,
  orderId: payment.orderId,
  provider: payment.paymentProvider,
  providerOrderId: payment.providerOrderId,
  providerPaymentId: payment.providerPaymentId,
  amount: Number(payment.amount),
  amountRefunded: Number(payment.amountRefunded),
  refundableAmount: Number(payment.amount) - Number(payment.amountRefunded),
  currency: payment.currency,
  status: payment.status,
  paidAt: payment.paidAt,
  failureReason: payment.failureReason,
  createdAt: payment.createdAt,
  ...extra,
});

const serializeRefund = (refund) => ({
  id: refund.id,
  orderId: refund.orderId,
  paymentId: refund.paymentId,
  amount: Number(refund.amount),
  reason: refund.reason,
  status: refund.status,
  providerRefundId: refund.providerRefundId,
  requestedBy: refund.requestedBy,
  reviewedBy: refund.reviewedBy,
  reviewedAt: refund.reviewedAt,
  rejectionReason: refund.rejectionReason,
  processedAt: refund.processedAt,
  createdAt: refund.createdAt,
});

/** Records a provider interaction. Also the webhook idempotency key. */
const writeTransaction = ({
  paymentId, transactionType, providerReference, amount, status, payload, actorId, transaction,
}) => PaymentTransaction.create(
  {
    paymentId,
    transactionType,
    providerReference: providerReference || null,
    amount,
    status,
    payload: payload || null,
    createdBy: actorId ?? null,
  },
  { transaction }
);

/* -------------------------------------------------------------------------- */
/*                          CREATE A PAYMENT INTENT                           */
/* -------------------------------------------------------------------------- */
/**
 * Opens a provider order for an order awaiting payment. Re-callable: an
 * abandoned attempt returns the existing intent rather than orphaning it at the
 * provider.
 */
const createIntent = async (req, res) => {
  try {
    const order = await orderService.loadAuthorizedOrder(req.body.orderId, req);

    if (order.status !== ORDER_STATUS.PAYMENT_PENDING
      && order.status !== ORDER_STATUS.PAYMENT_FAILED) {
      return fail(
        res,
        `This order is ${order.status} and is not awaiting payment`,
        409
      );
    }

    if (order.paymentStatus === ORDER_PAYMENT_STATUS.PAID) {
      return fail(res, 'This order has already been paid', 409);
    }

    // Reuse a live intent rather than creating a second one for the same order.
    const existing = await Payment.findOne({
      where: { orderId: order.id, status: PAYMENT_STATUS.PENDING },
      order: [['createdAt', 'DESC']],
    });

    if (existing && existing.providerOrderId) {
      return ok(
        res,
        {
          payment: serializePayment(existing),
          providerOrderId: existing.providerOrderId,
          amount: Number(existing.amount),
          currency: existing.currency,
          publicKey: config.payment.keyId || null,
          reused: true,
        },
        'Payment intent fetched successfully'
      );
    }

    const provider = paymentService.getProvider();

    // The amount always comes from the order, never from the request.
    const amount = Number(order.grandTotal);

    const providerOrder = await provider.createOrder({
      amount,
      currency: config.payment.currency,
      receipt: order.orderNumber,
      notes: { orderId: String(order.id), orderNumber: order.orderNumber },
    });

    const payment = await sequelize.transaction(async (transaction) => {
      const record = await Payment.create(
        {
          orderId: order.id,
          paymentProvider: paymentService.providerEnumValue(),
          providerOrderId: providerOrder.providerOrderId,
          amount,
          currency: config.payment.currency,
          status: PAYMENT_STATUS.PENDING,
          rawResponse: providerOrder.raw,
          createdBy: req.user.id,
        },
        { transaction }
      );

      await writeTransaction({
        paymentId: record.id,
        transactionType: PAYMENT_TRANSACTION_TYPE.AUTHORIZE,
        providerReference: providerOrder.providerOrderId,
        amount,
        status: 'CREATED',
        payload: providerOrder.raw,
        actorId: req.user.id,
        transaction,
      });

      return record;
    });

    await recordAudit({
      action: AUDIT_ACTIONS.PAYMENT_INITIATED,
      entityType: 'Payment',
      entityId: payment.id,
      newValues: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount,
        providerOrderId: providerOrder.providerOrderId,
      },
      req,
    });

    return created(
      res,
      {
        payment: serializePayment(payment),
        providerOrderId: providerOrder.providerOrderId,
        amount,
        currency: config.payment.currency,
        // The publishable key the client needs to open the provider's checkout.
        publicKey: config.payment.keyId || null,
        orderNumber: order.orderNumber,
      },
      'Payment intent created successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    logger.error('Payment intent creation failed: %s', error.message);
    return fail(res, 'Could not start the payment', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             CONFIRM A PAYMENT                              */
/* -------------------------------------------------------------------------- */
/**
 * Completes the client-side handshake: verifies the provider signature, captures
 * the payment and advances the order to CONFIRMED — all in one transaction, so
 * an order can never be marked paid without its payment row agreeing.
 */
const confirm = async (req, res) => {
  try {
    const payment = await Payment.findOne({
      where: { providerOrderId: req.body.providerOrderId },
    });
    if (!payment) return fail(res, 'No payment found for that provider order', 404);

    // Authorises the caller against the order the payment belongs to.
    const order = await orderService.loadAuthorizedOrder(payment.orderId, req);

    if (payment.status === PAYMENT_STATUS.CAPTURED) {
      return ok(
        res,
        { payment: serializePayment(payment), order: orderService.serialize(order) },
        'Payment was already confirmed'
      );
    }

    // Without this, knowing an order id would be enough to mark it paid.
    paymentService.assertPaymentSignature({
      providerOrderId: req.body.providerOrderId,
      providerPaymentId: req.body.providerPaymentId,
      signature: req.body.signature,
    });

    const result = await sequelize.transaction(async (transaction) => {
      await payment.update(
        {
          providerPaymentId: req.body.providerPaymentId,
          status: PAYMENT_STATUS.CAPTURED,
          paidAt: new Date(),
          failureReason: null,
          updatedBy: req.user.id,
        },
        { transaction }
      );

      await writeTransaction({
        paymentId: payment.id,
        transactionType: PAYMENT_TRANSACTION_TYPE.CAPTURE,
        providerReference: req.body.providerPaymentId,
        amount: Number(payment.amount),
        status: 'CAPTURED',
        payload: { providerOrderId: req.body.providerOrderId },
        actorId: req.user.id,
        transaction,
      });

      const locked = await orderService.loadAuthorizedOrder(payment.orderId, req, { transaction });

      await locked.update(
        { paymentStatus: ORDER_PAYMENT_STATUS.PAID, updatedBy: req.user.id },
        { transaction }
      );

      // A paid order moves itself forward; the customer should not have to.
      const transitioned = await orderService.applyStatusTransition({
        order: locked,
        toStatus: ORDER_STATUS.CONFIRMED,
        req,
        transaction,
        note: 'Payment captured',
        skipRoleCheck: true,
      });

      return transitioned;
    });

    await recordAudit({
      action: AUDIT_ACTIONS.PAYMENT_CONFIRMED,
      entityType: 'Payment',
      entityId: payment.id,
      newValues: {
        orderId: payment.orderId,
        providerPaymentId: req.body.providerPaymentId,
        amount: Number(payment.amount),
      },
      req,
    });

    await orderService.announceTransition({
      order: result.order,
      from: result.from,
      to: result.to,
      req,
    });

    const full = await orderService.loadAuthorizedOrder(payment.orderId, req);
    return ok(
      res,
      { payment: serializePayment(payment), order: orderService.serialize(full) },
      'Payment confirmed successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    logger.error('Payment confirmation failed: %s', error.message);
    return fail(res, 'Could not confirm the payment', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             MARK A FAILURE                                 */
/* -------------------------------------------------------------------------- */
/**
 * The client reporting an abandoned or declined attempt. Advisory only — it
 * cannot mark anything paid, and the stock stays reserved so the customer can
 * retry without losing their order.
 */
const markFailed = async (req, res) => {
  try {
    const payment = await Payment.findOne({
      where: { providerOrderId: req.body.providerOrderId },
    });
    if (!payment) return fail(res, 'No payment found for that provider order', 404);

    const order = await orderService.loadAuthorizedOrder(payment.orderId, req);

    if (payment.status === PAYMENT_STATUS.CAPTURED) {
      return fail(res, 'This payment has already been captured', 409);
    }

    await sequelize.transaction(async (transaction) => {
      await payment.update(
        {
          status: PAYMENT_STATUS.FAILED,
          failureReason: req.body.reason || 'Reported failed by the client',
          updatedBy: req.user.id,
        },
        { transaction }
      );

      await writeTransaction({
        paymentId: payment.id,
        transactionType: PAYMENT_TRANSACTION_TYPE.FAILED,
        providerReference: req.body.providerPaymentId || null,
        amount: Number(payment.amount),
        status: 'FAILED',
        payload: { reason: req.body.reason || null },
        actorId: req.user.id,
        transaction,
      });

      if (order.status === ORDER_STATUS.PAYMENT_PENDING) {
        await order.update(
          {
            status: ORDER_STATUS.PAYMENT_FAILED,
            paymentStatus: ORDER_PAYMENT_STATUS.FAILED,
            updatedBy: req.user.id,
          },
          { transaction }
        );

        await orderService.recordStatusChange(
          order,
          ORDER_STATUS.PAYMENT_PENDING,
          ORDER_STATUS.PAYMENT_FAILED,
          req,
          req.body.reason || 'Payment failed',
          transaction
        );
      }
    });

    const full = await orderService.loadAuthorizedOrder(payment.orderId, req);
    return updated(
      res,
      { payment: serializePayment(payment), order: orderService.serialize(full) },
      'Payment marked as failed. Your items are still reserved — you can try again.'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Could not record the payment failure', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             PROVIDER WEBHOOK                               */
/* -------------------------------------------------------------------------- */
/**
 * The authoritative payment signal. Unauthenticated by necessity — the provider
 * has no token — so the signature over the raw body is the entire security
 * boundary, and `app.js` preserves that raw body before JSON parsing.
 *
 * Idempotent: `(transaction_type, provider_reference)` is unique, so a provider
 * retrying the same event is absorbed rather than double-applied.
 */
const webhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature']
      || req.headers['x-webhook-signature'];

    const provider = paymentService.getProvider();

    if (!provider.verifyWebhookSignature(req.rawBody, signature)) {
      logger.warn('Rejected payment webhook with an invalid signature');
      // 400, not 401: there is no identity to challenge here.
      return fail(res, 'Invalid webhook signature', 400);
    }

    const event = req.body?.event || req.body?.type || 'unknown';
    const entity = req.body?.payload?.payment?.entity || req.body?.payload || {};
    const providerPaymentId = entity.id || req.body?.providerPaymentId;
    const providerOrderId = entity.order_id || req.body?.providerOrderId;

    logger.info('Payment webhook received: %s (payment %s)', event, providerPaymentId);

    await recordAudit({
      action: AUDIT_ACTIONS.PAYMENT_WEBHOOK_RECEIVED,
      entityType: 'Payment',
      newValues: { event, providerPaymentId, providerOrderId },
      req,
    });

    if (!providerOrderId) {
      // Acknowledge: a 2xx stops the provider retrying an event we cannot use.
      return ok(res, { handled: false, reason: 'No provider order id in payload' }, 'Webhook received');
    }

    const payment = await Payment.findOne({ where: { providerOrderId } });
    if (!payment) {
      return ok(res, { handled: false, reason: 'Unknown provider order' }, 'Webhook received');
    }

    const isCapture = /captured|paid|success/i.test(event);
    const isFailure = /failed|cancelled/i.test(event);

    if (!isCapture && !isFailure) {
      return ok(res, { handled: false, event }, 'Webhook received');
    }

    // Absorbed here if the provider is retrying an event already applied.
    const alreadyApplied = await PaymentTransaction.findOne({
      where: {
        transactionType: PAYMENT_TRANSACTION_TYPE.WEBHOOK,
        providerReference: providerPaymentId || providerOrderId,
      },
    });

    if (alreadyApplied) {
      return ok(res, { handled: true, duplicate: true }, 'Webhook already processed');
    }

    const systemReq = { user: { id: null, roles: [ROLES.SUPER_ADMIN], isSuperAdmin: true }, headers: req.headers };

    await sequelize.transaction(async (transaction) => {
      await writeTransaction({
        paymentId: payment.id,
        transactionType: PAYMENT_TRANSACTION_TYPE.WEBHOOK,
        providerReference: providerPaymentId || providerOrderId,
        amount: Number(payment.amount),
        status: isCapture ? 'CAPTURED' : 'FAILED',
        payload: req.body,
        actorId: null,
        transaction,
      });

      const order = await Order.findByPk(payment.orderId, {
        include: orderService.orderIncludes,
        transaction,
      });
      if (!order) return;

      if (isCapture && payment.status !== PAYMENT_STATUS.CAPTURED) {
        await payment.update(
          {
            providerPaymentId: providerPaymentId || payment.providerPaymentId,
            status: PAYMENT_STATUS.CAPTURED,
            paidAt: new Date(),
            rawResponse: req.body,
          },
          { transaction }
        );

        await order.update({ paymentStatus: ORDER_PAYMENT_STATUS.PAID }, { transaction });

        if (order.status === ORDER_STATUS.PAYMENT_PENDING
          || order.status === ORDER_STATUS.PAYMENT_FAILED) {
          await orderService.applyStatusTransition({
            order,
            toStatus: ORDER_STATUS.CONFIRMED,
            req: systemReq,
            transaction,
            note: 'Payment captured via webhook',
            skipRoleCheck: true,
          });
        }
      }

      if (isFailure && payment.status !== PAYMENT_STATUS.CAPTURED) {
        await payment.update(
          {
            status: PAYMENT_STATUS.FAILED,
            failureReason: entity.error_description || 'Reported failed by the provider',
            rawResponse: req.body,
          },
          { transaction }
        );

        if (order.status === ORDER_STATUS.PAYMENT_PENDING) {
          await order.update(
            {
              status: ORDER_STATUS.PAYMENT_FAILED,
              paymentStatus: ORDER_PAYMENT_STATUS.FAILED,
            },
            { transaction }
          );

          await orderService.recordStatusChange(
            order,
            ORDER_STATUS.PAYMENT_PENDING,
            ORDER_STATUS.PAYMENT_FAILED,
            systemReq,
            'Payment failed (webhook)',
            transaction
          );
        }
      }
    });

    return ok(res, { handled: true, event }, 'Webhook processed');
  } catch (error) {
    logger.error('Payment webhook processing failed: %s', error.message);
    // Still 200: a 5xx makes the provider retry a payload we already logged.
    return ok(res, { handled: false, error: error.message }, 'Webhook received');
  }
};

/* -------------------------------------------------------------------------- */
/*                             LIST PAYMENTS                                  */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    // Scope by the orders the caller may see, so a customer sees only their own.
    const orderWhere = {};
    if (!(await orderService.scopeOrders(orderWhere, req, req.body))) {
      return paginated(res, [], { page, limit, total: 0 }, 'Payments fetched successfully');
    }

    const visible = await Order.findAll({ where: orderWhere, attributes: ['id'] });
    if (!visible.length) {
      return paginated(res, [], { page, limit, total: 0 }, 'Payments fetched successfully');
    }

    const where = { orderId: { [Op.in]: visible.map((o) => o.id) } };
    if (req.body.status) where.status = req.body.status;
    if (req.body.orderId) where.orderId = req.body.orderId;

    const result = await Payment.findAndCountAll({
      where,
      include: [{ model: Order, as: 'order', attributes: ['id', 'orderNumber', 'status'] }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((p) => serializePayment(p, {
        order: p.order
          ? { id: p.order.id, orderNumber: p.order.orderNumber, status: p.order.status }
          : null,
      })),
      toPageMeta(result, { page, limit }),
      'Payments fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching payments', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            GET ONE PAYMENT                                 */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.body.id);
    if (!payment) return fail(res, 'Payment not found', 404);

    await orderService.loadAuthorizedOrder(payment.orderId, req);

    const transactions = await PaymentTransaction.findAll({
      where: { paymentId: payment.id },
      order: [['createdAt', 'ASC']],
    });

    return ok(
      res,
      serializePayment(payment, {
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.transactionType,
          providerReference: t.providerReference,
          amount: Number(t.amount),
          status: t.status,
          createdAt: t.createdAt,
        })),
      }),
      'Payment fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching payment', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                  REFUNDS                                   */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                             REQUEST A REFUND                               */
/* -------------------------------------------------------------------------- */
const requestRefund = async (req, res) => {
  try {
    const order = await orderService.loadAuthorizedOrder(req.body.orderId, req);

    const payment = await Payment.findOne({
      where: { orderId: order.id, status: PAYMENT_STATUS.CAPTURED },
      order: [['createdAt', 'DESC']],
    });

    if (!payment) {
      return fail(res, 'This order has no captured payment to refund', 409);
    }

    const refundable = Number(payment.amount) - Number(payment.amountRefunded);
    const amount = req.body.amount ? money.round2(req.body.amount) : refundable;

    if (amount <= 0) return fail(res, 'The refund amount must be greater than zero', 422);

    if (amount > refundable) {
      return fail(
        res,
        `Only ${refundable} remains refundable on this payment`,
        409,
        [{ field: 'amount', refundable }]
      );
    }

    const pending = await Refund.findOne({
      where: {
        orderId: order.id,
        status: { [Op.in]: [REFUND_STATUS.REQUESTED, REFUND_STATUS.APPROVED, REFUND_STATUS.PROCESSING] },
      },
    });
    if (pending) return fail(res, 'A refund is already in progress for this order', 409);

    const refund = await Refund.create({
      orderId: order.id,
      paymentId: payment.id,
      amount,
      reason: req.body.reason,
      status: REFUND_STATUS.REQUESTED,
      requestedBy: req.user.id,
      createdBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.REFUND_REQUESTED,
      entityType: 'Refund',
      entityId: refund.id,
      newValues: { orderId: order.id, amount, reason: req.body.reason },
      req,
    });

    return created(res, serializeRefund(refund), 'Refund requested successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error requesting refund', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       APPROVE, REJECT OR PROCESS A REFUND                  */
/* -------------------------------------------------------------------------- */
/**
 * Approving calls the provider and, once it settles, moves the order to
 * REFUNDED. Returned goods go back on the shelf only when the order had already
 * been delivered — stock from a cancelled order was released at cancellation,
 * and adding it again would invent inventory.
 */
const reviewRefund = async (req, res) => {
  try {
    const refund = await Refund.findByPk(req.body.id, {
      include: [{ model: Payment, as: 'payment' }],
    });
    if (!refund) return fail(res, 'Refund not found', 404);

    if (refund.status !== REFUND_STATUS.REQUESTED) {
      return fail(res, `This refund is already ${refund.status.toLowerCase()}`, 409);
    }

    const approving = req.body.status === REFUND_STATUS.APPROVED;

    if (!approving) {
      if (!req.body.rejectionReason) {
        return fail(res, 'A rejection reason is required', 422, [
          { field: 'rejectionReason', message: 'Required when rejecting' },
        ]);
      }

      await refund.update({
        status: REFUND_STATUS.REJECTED,
        rejectionReason: req.body.rejectionReason,
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        updatedBy: req.user.id,
      });

      await recordAudit({
        action: AUDIT_ACTIONS.REFUND_REVIEWED,
        entityType: 'Refund',
        entityId: refund.id,
        newValues: { status: REFUND_STATUS.REJECTED, reason: req.body.rejectionReason },
        req,
      });

      return updated(res, serializeRefund(refund), 'Refund rejected');
    }

    const payment = refund.payment;
    if (!payment?.providerPaymentId) {
      return fail(res, 'This payment has no provider reference to refund against', 409);
    }

    await refund.update({
      status: REFUND_STATUS.PROCESSING,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      updatedBy: req.user.id,
    });

    const provider = paymentService.getProvider();
    let providerRefund;

    try {
      providerRefund = await provider.refund({
        providerPaymentId: payment.providerPaymentId,
        amount: Number(refund.amount),
        notes: { refundId: String(refund.id), orderId: String(refund.orderId) },
      });
    } catch (err) {
      // Leave a trail: a refund stuck in FAILED is recoverable, a silent one is not.
      await refund.update({
        status: REFUND_STATUS.FAILED,
        rejectionReason: err.message,
        updatedBy: req.user.id,
      });
      logger.error('Refund %s failed at the provider: %s', refund.id, err.message);
      return fail(res, 'The provider could not process this refund', 502, [{ message: err.message }]);
    }

    const result = await sequelize.transaction(async (transaction) => {
      const totalRefunded = money.round2(
        Number(payment.amountRefunded) + Number(refund.amount)
      );
      const fullyRefunded = money.equals(totalRefunded, Number(payment.amount));

      await payment.update(
        {
          amountRefunded: totalRefunded,
          status: fullyRefunded ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED,
          updatedBy: req.user.id,
        },
        { transaction }
      );

      await refund.update(
        {
          status: REFUND_STATUS.COMPLETED,
          providerRefundId: providerRefund.providerRefundId,
          processedAt: new Date(),
          updatedBy: req.user.id,
        },
        { transaction }
      );

      await writeTransaction({
        paymentId: payment.id,
        transactionType: PAYMENT_TRANSACTION_TYPE.REFUND,
        providerReference: providerRefund.providerRefundId,
        amount: Number(refund.amount),
        status: 'REFUNDED',
        payload: providerRefund.raw,
        actorId: req.user.id,
        transaction,
      });

      const order = await Order.findByPk(refund.orderId, {
        include: orderService.orderIncludes,
        transaction,
      });

      await order.update(
        {
          paymentStatus: fullyRefunded
            ? ORDER_PAYMENT_STATUS.REFUNDED
            : ORDER_PAYMENT_STATUS.PARTIALLY_REFUNDED,
          updatedBy: req.user.id,
        },
        { transaction }
      );

      // Only a delivered order still has stock in the customer's hands. A
      // cancelled order released its reservation at cancellation.
      const wasDelivered = order.status === ORDER_STATUS.DELIVERED;

      if (wasDelivered && fullyRefunded) {
        await inventoryService.returnStock(
          order.items.map((i) => ({
            productVariantId: i.productVariantId,
            quantity: i.quantity,
          })),
          {
            vendorId: order.vendorId,
            orderId: order.id,
            actorId: req.user.id,
            transaction,
          }
        );
      }

      let transitioned = null;
      if (fullyRefunded
        && [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED].includes(order.status)) {
        transitioned = await orderService.applyStatusTransition({
          order,
          toStatus: ORDER_STATUS.REFUNDED,
          req,
          transaction,
          note: `Refund ${refund.id} completed`,
        });
      }

      return { order, transitioned, fullyRefunded };
    });

    await recordAudit({
      action: AUDIT_ACTIONS.REFUND_REVIEWED,
      entityType: 'Refund',
      entityId: refund.id,
      newValues: {
        status: REFUND_STATUS.COMPLETED,
        amount: Number(refund.amount),
        providerRefundId: providerRefund.providerRefundId,
      },
      req,
    });

    if (result.transitioned) {
      await orderService.announceTransition({
        order: result.transitioned.order,
        from: result.transitioned.from,
        to: result.transitioned.to,
        req,
      });
    }

    const customerProfile = await CustomerProfile.findByPk(result.order.customerId, {
      attributes: ['userId'],
    });

    if (customerProfile) {
      await notificationService.notify({
        userId: customerProfile.userId,
        templateCode: 'REFUND_COMPLETED',
        title: 'Refund processed',
        message: `A refund of ${refund.amount} for order ${result.order.orderNumber} has been processed. It should reach your account within a few working days.`,
        referenceType: 'Refund',
        referenceId: refund.id,
      });
    }

    return updated(res, serializeRefund(refund), 'Refund processed successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    logger.error('Refund review failed: %s', error.message);
    return fail(res, 'Error processing refund', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              LIST REFUNDS                                  */
/* -------------------------------------------------------------------------- */
const listRefunds = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: REFUND_SORTABLE,
    });

    const orderWhere = {};
    if (!(await orderService.scopeOrders(orderWhere, req, req.body))) {
      return paginated(res, [], { page, limit, total: 0 }, 'Refunds fetched successfully');
    }

    const visible = await Order.findAll({ where: orderWhere, attributes: ['id'] });
    if (!visible.length) {
      return paginated(res, [], { page, limit, total: 0 }, 'Refunds fetched successfully');
    }

    const where = { orderId: { [Op.in]: visible.map((o) => o.id) } };
    if (req.body.status) where.status = req.body.status;
    if (req.body.orderId) where.orderId = req.body.orderId;

    const result = await Refund.findAndCountAll({
      where,
      include: [{ model: Order, as: 'order', attributes: ['id', 'orderNumber', 'status'] }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((r) => ({
        ...serializeRefund(r),
        order: r.order
          ? { id: r.order.id, orderNumber: r.order.orderNumber, status: r.order.status }
          : null,
      })),
      toPageMeta(result, { page, limit }),
      'Refunds fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching refunds', 500, [{ message: error.message }]);
  }
};

module.exports = {
  createIntent,
  confirm,
  markFailed,
  webhook,
  list,
  detail,
  requestRefund,
  reviewRefund,
  listRefunds,
  serializePayment,
  serializeRefund,
};
