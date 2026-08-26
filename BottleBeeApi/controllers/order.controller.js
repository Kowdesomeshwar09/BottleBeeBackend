'use strict';

const { Op, UniqueConstraintError } = require('sequelize');

const config = require('../config');
const logger = require('../config/logger');
const {
  sequelize, Order, OrderItem, OrderStatusHistory, Cart, CustomerProfile, CustomerAddress,
  Vendor, Payment, Refund, DeliveryAssignment, DeliveryPartner, User,
} = require('../models');
const {
  ORDER_STATUS, ORDER_PAYMENT_STATUS, ORDER_DELIVERY_STATUS, CART_STATUS,
  PAYMENT_PROVIDER, ROLES, VENDOR_ROLE, AUDIT_ACTIONS,
} = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { generateOrderNumber } = require('../utils/orderNumber');
const { assertCustomerMayCancel } = require('../utils/orderStateMachine');
const { recordAudit } = require('../utils/audit');
const money = require('../utils/money');
const {
  ok, created, paginated, updated, fail,
} = require('../utils/response');
const orderService = require('../services/order.service');
const cartService = require('../services/cart.service');
const pricingService = require('../services/pricing.service');
const promotionService = require('../services/promotion.service');
const inventoryService = require('../services/inventory.service');
const complianceService = require('../services/compliance.service');
const vendorAccessService = require('../services/vendorAccess.service');
const notificationService = require('../services/notification.service');

/**
 * Checkout and orders.
 *
 * Checkout is one database transaction. Everything that must be true for a
 * legal alcohol sale is re-checked inside it, from the server's own data —
 * never from anything the client sent:
 *
 *    1  the caller has a customer profile
 *    2  the cart is not empty
 *    3  every item belongs to one store (single-vendor by design)
 *    4  the delivery address belongs to the caller
 *    5  every item is still purchasable
 *    6  totals are recomputed server-side; no price arrives from the client
 *    7  the store's minimum order value is met
 *    8  regional compliance passes: age, verification, dry day, sale window,
 *       quantity and value caps
 *    9  the store is APPROVED and licensed for the delivery region
 *   10  the order and its items are written
 *   11  stock is reserved atomically, and a losing race aborts the checkout
 *   12  the coupon is redeemed within its usage limit
 *   13  the cart is consumed only once the order exists
 *
 * Any failure rolls the whole thing back, so a rejected checkout never leaves
 * stock reserved, a coupon burnt, or half an order behind.
 */

const SORTABLE = ['id', 'orderNumber', 'status', 'grandTotal', 'createdAt', 'deliveredAt'];

/** The order number is random, so a collision is possible but rare. */
const ORDER_NUMBER_RETRIES = 3;

/* -------------------------------------------------------------------------- */
/*                                  CHECKOUT                                  */
/* -------------------------------------------------------------------------- */

/** The transactional body of checkout. Retried on an order-number collision. */
async function runCheckout(req) {
  return sequelize.transaction(async (transaction) => {
    // --- 1. Customer -----------------------------------------------------
    const profile = await CustomerProfile.findOne({
      where: { userId: req.user.id },
      transaction,
    });
    if (!profile) {
      throw Object.assign(
        new Error('Complete your customer profile before placing an order'),
        { statusCode: 409 }
      );
    }

    // --- 2. Cart ---------------------------------------------------------
    const cart = await Cart.findOne({
      where: { customerId: profile.id, status: CART_STATUS.ACTIVE },
      order: [['createdAt', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!cart) throw Object.assign(new Error('Your cart is empty'), { statusCode: 409 });

    const items = await cartService.loadItems(cart.id, { transaction });
    if (!items.length) throw Object.assign(new Error('Your cart is empty'), { statusCode: 409 });

    // --- 3. Single store --------------------------------------------------
    const vendorIds = [...new Set(items.map((i) => Number(i.variant.product.vendorId)))];
    if (vendorIds.length > 1) {
      throw Object.assign(
        new Error('Your cart contains items from more than one store. Bottle Bee delivers from one store per order.'),
        { statusCode: 409, errors: [{ code: 'MIXED_VENDOR_CART', vendorIds }] }
      );
    }
    const vendorId = vendorIds[0];

    // --- 4. Delivery address ---------------------------------------------
    const addressId = req.body.deliveryAddressId || profile.defaultAddressId;
    if (!addressId) {
      throw Object.assign(new Error('Choose a delivery address'), {
        statusCode: 400,
        errors: [{ field: 'deliveryAddressId', message: 'Required' }],
      });
    }

    const address = await CustomerAddress.findOne({
      where: { id: addressId, customerId: profile.id },
      transaction,
    });
    if (!address) {
      throw Object.assign(
        new Error('That delivery address was not found on your account'),
        { statusCode: 404 }
      );
    }

    // --- 5. Everything still purchasable ---------------------------------
    const unavailable = items.filter((item) => !cartService.isPurchasable(item));
    if (unavailable.length) {
      throw Object.assign(
        new Error('Some items in your cart are no longer available. Please review your cart.'),
        {
          statusCode: 409,
          errors: unavailable.map((item) => ({
            code: 'ITEM_UNAVAILABLE',
            cartItemId: item.id,
            productName: item.variant?.product?.name,
          })),
        }
      );
    }

    // --- 6. Totals, computed server-side ---------------------------------
    let coupon = null;
    const rawSubtotal = items.reduce(
      (sum, item) => sum + Number(item.variant.sellingPrice) * item.quantity,
      0
    );

    if (cart.couponCode) {
      const validated = await promotionService.validateForCart({
        code: cart.couponCode,
        userId: req.user.id,
        subtotal: rawSubtotal,
        vendorId,
        transaction,
      });
      coupon = validated.coupon;
    }

    const totals = pricingService.computeTotals(
      items.map((item) => ({
        productId: item.variant.product.id,
        productVariantId: item.productVariantId,
        productName: item.variant.product.name,
        variantLabel: typeof item.variant.label === 'function' ? item.variant.label() : null,
        sku: item.variant.sku,
        quantity: item.quantity,
        unitPrice: Number(item.variant.sellingPrice),
        taxPercent: Number(item.variant.taxPercent || 0),
      })),
      { coupon }
    );

    // --- 7. Store minimum order ------------------------------------------
    const vendor = await Vendor.findByPk(vendorId, { transaction });
    if (vendor?.minOrderAmount && totals.subtotal < Number(vendor.minOrderAmount)) {
      throw Object.assign(
        new Error(`${vendor.businessName} has a minimum order value of ${vendor.minOrderAmount}.`),
        {
          statusCode: 409,
          errors: [{
            code: 'BELOW_MINIMUM_ORDER',
            minOrderAmount: Number(vendor.minOrderAmount),
            subtotal: totals.subtotal,
          }],
        }
      );
    }

    // --- 8. Regional compliance ------------------------------------------
    const complianceReport = await complianceService.assertOrderCompliant({
      address,
      dateOfBirth: profile.dateOfBirth,
      ageVerified: profile.ageVerified,
      totalQuantity: totals.totalQuantity,
      grandTotal: totals.grandTotal,
      productTypes: items.map((i) => i.variant.product.productType),
    });

    // --- 9. Store licensed for this region -------------------------------
    await vendorAccessService.assertOperational(vendorId, complianceReport.regionCode, {
      transaction,
    });

    // --- 10. The order ----------------------------------------------------
    const paymentMethod = req.body.paymentMethod || PAYMENT_PROVIDER.RAZORPAY;
    const isCashOnDelivery = paymentMethod === PAYMENT_PROVIDER.CASH;

    // Nothing to collect online for cash on delivery, so it confirms at once.
    const initialStatus = isCashOnDelivery
      ? ORDER_STATUS.CONFIRMED
      : ORDER_STATUS.PAYMENT_PENDING;

    const order = await Order.create(
      {
        orderNumber: generateOrderNumber(),
        customerId: profile.id,
        vendorId,
        deliveryAddressId: address.id,
        cartId: cart.id,
        status: initialStatus,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        deliveryFee: totals.deliveryFee,
        grandTotal: totals.grandTotal,
        paymentStatus: ORDER_PAYMENT_STATUS.PENDING,
        deliveryStatus: ORDER_DELIVERY_STATUS.PENDING,
        // Frozen, so editing or deleting the address never rewrites history.
        deliveryAddressSnapshot: address.toSnapshot(),
        regionCode: complianceReport.regionCode,
        customerNotes: req.body.customerNotes || null,
        confirmedAt: isCashOnDelivery ? new Date() : null,
        createdBy: req.user.id,
      },
      { transaction }
    );

    await OrderItem.bulkCreate(
      totals.lines.map((line) => ({
        orderId: order.id,
        productId: line.productId,
        productVariantId: line.productVariantId,
        productName: line.productName,
        variantLabel: line.variantLabel,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxAmount: line.taxAmount,
        discountAmount: line.discountAmount,
        lineTotal: line.lineTotal,
        createdBy: req.user.id,
      })),
      { transaction }
    );

    // --- 11. Reserve stock ------------------------------------------------
    await inventoryService.reserve(
      totals.lines.map((l) => ({ productVariantId: l.productVariantId, quantity: l.quantity })),
      { vendorId, orderId: order.id, actorId: req.user.id, transaction }
    );

    // --- 12. Redeem the coupon --------------------------------------------
    if (coupon) {
      await promotionService.redeem({
        coupon,
        userId: req.user.id,
        orderId: order.id,
        discountAmount: totals.discountTotal,
        actorId: req.user.id,
        transaction,
      });
    }

    // --- 13. History, then consume the cart -------------------------------
    await orderService.recordStatusChange(
      order,
      null,
      initialStatus,
      req,
      isCashOnDelivery ? 'Order placed, cash on delivery' : 'Order placed, awaiting payment',
      transaction
    );

    await cart.update({ status: CART_STATUS.ORDERED, updatedBy: req.user.id }, { transaction });

    return { order, vendor, coupon, paymentMethod, isCashOnDelivery };
  });
}

const checkout = async (req, res) => {
  let attempt = 0;

  /* eslint-disable no-await-in-loop */
  while (attempt < ORDER_NUMBER_RETRIES) {
    attempt += 1;

    try {
      const result = await runCheckout(req);

      await recordAudit({
        action: AUDIT_ACTIONS.ORDER_PLACED,
        entityType: 'Order',
        entityId: result.order.id,
        newValues: {
          orderNumber: result.order.orderNumber,
          vendorId: result.order.vendorId,
          grandTotal: result.order.grandTotal,
          paymentMethod: result.paymentMethod,
          regionCode: result.order.regionCode,
          couponCode: result.coupon?.code || null,
        },
        req,
      });

      await notificationService.notify({
        userId: req.user.id,
        templateCode: 'ORDER_PLACED',
        title: `Order ${result.order.orderNumber} placed`,
        message: result.isCashOnDelivery
          ? `Your order from ${result.vendor?.businessName} is confirmed. Pay ${result.order.grandTotal} on delivery.`
          : `Your order from ${result.vendor?.businessName} is reserved. Complete payment of ${result.order.grandTotal} to confirm it.`,
        referenceType: 'Order',
        referenceId: result.order.id,
        actions: [{ label: 'Track order', url: `/orders/${result.order.id}` }],
      });

      if (result.vendor) {
        await notificationService.notify({
          userId: result.vendor.ownerUserId,
          templateCode: 'ORDER_RECEIVED_VENDOR',
          title: `New order ${result.order.orderNumber}`,
          message: `A new order worth ${result.order.grandTotal} has been placed${result.isCashOnDelivery ? ' (cash on delivery)' : ' and is awaiting payment'}.`,
          referenceType: 'Order',
          referenceId: result.order.id,
        });
      }

      const full = await orderService.loadAuthorizedOrder(result.order.id, req);
      return created(res, orderService.serialize(full), 'Order placed successfully');
    } catch (error) {
      const isOrderNumberClash = error instanceof UniqueConstraintError
        && (error.errors || []).some((e) => e.path === 'order_number' || e.path === 'orderNumber');

      if (isOrderNumberClash && attempt < ORDER_NUMBER_RETRIES) {
        logger.warn('Order number collision on attempt %s — retrying', attempt);
        continue;
      }

      if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
      logger.error('Checkout failed: %s', error.message);
      return fail(res, 'Checkout failed', 500, [{ message: error.message }]);
    }
  }
  /* eslint-enable no-await-in-loop */

  return fail(res, 'Could not allocate an order number. Please try again.', 500);
};

/* -------------------------------------------------------------------------- */
/*                                LIST ORDERS                                 */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {};
    if (!(await orderService.scopeOrders(where, req, req.body))) {
      return paginated(res, [], { page, limit, total: 0 }, 'Orders fetched successfully');
    }

    if (req.body.status) where.status = { [Op.in]: [].concat(req.body.status) };
    if (req.body.paymentStatus) where.paymentStatus = req.body.paymentStatus;
    if (req.body.deliveryStatus) where.deliveryStatus = req.body.deliveryStatus;
    if (req.body.orderNumber) where.orderNumber = { [Op.like]: `%${req.body.orderNumber}%` };
    if (req.body.search) where.orderNumber = { [Op.like]: `%${req.body.search}%` };

    if (req.body.fromDate || req.body.toDate) {
      where.createdAt = {};
      if (req.body.fromDate) where.createdAt[Op.gte] = new Date(req.body.fromDate);
      if (req.body.toDate) where.createdAt[Op.lte] = new Date(req.body.toDate);
    }

    const result = await Order.findAndCountAll({
      where,
      include: orderService.orderIncludes,
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((o) => orderService.serialize(o)),
      toPageMeta(result, { page, limit }),
      'Orders fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching orders', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                               GET ONE ORDER                                */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const order = await orderService.loadAuthorizedOrder(req.body.id, req);

    const [history, payments, assignment, refunds] = await Promise.all([
      OrderStatusHistory.findAll({
        where: { orderId: order.id },
        include: [{
          model: User,
          as: 'actor',
          attributes: ['id', 'firstName', 'lastName'],
          required: false,
        }],
        order: [['createdAt', 'ASC']],
      }),
      Payment.findAll({ where: { orderId: order.id }, order: [['createdAt', 'DESC']] }),
      DeliveryAssignment.findOne({
        where: { orderId: order.id },
        include: [{
          model: DeliveryPartner,
          as: 'partner',
          include: [{
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'phone'],
          }],
        }],
      }),
      Refund.findAll({ where: { orderId: order.id }, order: [['createdAt', 'DESC']] }),
    ]);

    const liveDelivery = [ORDER_STATUS.PICKED_UP, ORDER_STATUS.OUT_FOR_DELIVERY]
      .includes(order.status);

    return ok(
      res,
      orderService.serialize(order, {
        statusHistory: history.map((h) => ({
          id: h.id,
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          note: h.note,
          changedAt: h.createdAt,
          changedBy: h.actor
            ? [h.actor.firstName, h.actor.lastName].filter(Boolean).join(' ')
            : 'System',
        })),
        payments: payments.map((p) => ({
          id: p.id,
          provider: p.paymentProvider,
          providerOrderId: p.providerOrderId,
          providerPaymentId: p.providerPaymentId,
          amount: Number(p.amount),
          amountRefunded: Number(p.amountRefunded),
          currency: p.currency,
          status: p.status,
          paidAt: p.paidAt,
          failureReason: p.failureReason,
        })),
        refunds: refunds.map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          reason: r.reason,
          status: r.status,
          processedAt: r.processedAt,
        })),
        delivery: assignment
          ? {
            id: assignment.id,
            status: assignment.status,
            assignedAt: assignment.assignedAt,
            acceptedAt: assignment.acceptedAt,
            pickedUpAt: assignment.pickedUpAt,
            deliveredAt: assignment.deliveredAt,
            recipientVerified: assignment.recipientVerified,
            partner: assignment.partner
              ? {
                id: assignment.partner.id,
                name: assignment.partner.user
                  ? [assignment.partner.user.firstName, assignment.partner.user.lastName]
                    .filter(Boolean).join(' ')
                  : null,
                // The rider's number is exposed only while a delivery is live.
                phone: liveDelivery ? assignment.partner.user?.phone : null,
                vehicleType: assignment.partner.vehicleType,
                vehicleNumber: assignment.partner.vehicleNumber,
                ratingAvg: Number(assignment.partner.ratingAvg || 0),
              }
              : null,
          }
          : null,
      }),
      'Order fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching order', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              TRACK AN ORDER                                */
/* -------------------------------------------------------------------------- */
/** Lightweight view for the customer's tracking screen. */
const track = async (req, res) => {
  try {
    const where = req.body.orderNumber
      ? { orderNumber: req.body.orderNumber }
      : { id: req.body.id };

    const found = await Order.findOne({ where, attributes: ['id'] });
    if (!found) return fail(res, 'Order not found', 404);

    // Reuse detail so access control and shaping stay in one place.
    const order = await orderService.loadAuthorizedOrder(found.id, req);

    const [history, assignment] = await Promise.all([
      OrderStatusHistory.findAll({
        where: { orderId: order.id },
        order: [['createdAt', 'ASC']],
        attributes: ['fromStatus', 'toStatus', 'note', 'createdAt'],
      }),
      DeliveryAssignment.findOne({
        where: { orderId: order.id },
        include: [{
          model: DeliveryPartner,
          as: 'partner',
          include: [{ model: User, as: 'user', attributes: ['firstName', 'phone'] }],
        }],
      }),
    ]);

    const liveDelivery = [ORDER_STATUS.PICKED_UP, ORDER_STATUS.OUT_FOR_DELIVERY]
      .includes(order.status);

    return ok(
      res,
      {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        deliveryStatus: order.deliveryStatus,
        grandTotal: Number(order.grandTotal),
        placedAt: order.createdAt,
        confirmedAt: order.confirmedAt,
        deliveredAt: order.deliveredAt,
        vendor: order.vendor
          ? { id: order.vendor.id, businessName: order.vendor.businessName }
          : null,
        deliveryAddress: order.deliveryAddressSnapshot,
        itemCount: order.items?.length ?? 0,
        statusHistory: history.map((h) => ({
          toStatus: h.toStatus,
          note: h.note,
          changedAt: h.createdAt,
        })),
        delivery: assignment
          ? {
            status: assignment.status,
            recipientVerified: assignment.recipientVerified,
            partnerName: assignment.partner?.user?.firstName || null,
            partnerPhone: liveDelivery ? assignment.partner?.user?.phone : null,
            vehicleNumber: assignment.partner?.vehicleNumber || null,
          }
          : null,
      },
      'Order tracking fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error tracking order', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             STATUS HISTORY                                 */
/* -------------------------------------------------------------------------- */
const statusHistory = async (req, res) => {
  try {
    const order = await orderService.loadAuthorizedOrder(req.body.id, req);

    const { page, limit, offset, order: ordering } = buildPagination(req.body, {
      sortable: ['id', 'createdAt'],
      defaultSort: 'createdAt',
      defaultOrder: 'ASC',
    });

    const result = await OrderStatusHistory.findAndCountAll({
      where: { orderId: order.id },
      include: [{
        model: User,
        as: 'actor',
        attributes: ['id', 'firstName', 'lastName'],
        required: false,
      }],
      limit,
      offset,
      order: ordering,
    });

    return paginated(
      res,
      result.rows.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        changedAt: h.createdAt,
        changedBy: h.actor
          ? [h.actor.firstName, h.actor.lastName].filter(Boolean).join(' ')
          : 'System',
      })),
      toPageMeta(result, { page, limit }),
      'Order history fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching order history', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          ADVANCE ORDER STATUS                              */
/* -------------------------------------------------------------------------- */
const updateStatus = async (req, res) => {
  try {
    const result = await sequelize.transaction(async (transaction) => {
      const order = await orderService.loadAuthorizedOrder(req.body.id, req, { transaction });

      // A vendor user may only drive their own store's orders.
      if (req.user.roles.includes(ROLES.VENDOR_OWNER)
        || req.user.roles.includes(ROLES.VENDOR_MANAGER)) {
        await vendorAccessService.assertVendorAccess(order.vendorId, req, {
          requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER],
        });
      }

      return orderService.applyStatusTransition({
        order,
        toStatus: req.body.status,
        req,
        transaction,
        reason: req.body.reason,
        note: req.body.note,
      });
    });

    await orderService.announceTransition({
      order: result.order,
      from: result.from,
      to: result.to,
      req,
      reason: req.body.reason || req.body.note,
    });

    const full = await orderService.loadAuthorizedOrder(result.order.id, req);
    return updated(res, orderService.serialize(full), `Order moved to ${result.to}`);
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error updating order status', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             CANCEL AN ORDER                                */
/* -------------------------------------------------------------------------- */
/**
 * Customer-initiated cancellation has a narrower window than an admin's: once
 * the store has confirmed, a short grace period applies, after which the store
 * may already have begun picking the order.
 */
const cancel = async (req, res) => {
  try {
    const order = await orderService.loadAuthorizedOrder(req.body.id, req);

    const isPlainCustomer = req.user.roles.includes(ROLES.CUSTOMER)
      && !req.user.isSuperAdmin
      && !req.user.roles.includes(ROLES.ADMIN);

    if (isPlainCustomer) {
      assertCustomerMayCancel(order.status);

      if (order.status === ORDER_STATUS.CONFIRMED && order.confirmedAt) {
        const elapsed = (Date.now() - new Date(order.confirmedAt).getTime()) / 60000;
        if (elapsed > config.fulfilment.cancellationWindowMinutes) {
          return fail(
            res,
            `This order was confirmed more than ${config.fulfilment.cancellationWindowMinutes} minutes ago and can no longer be cancelled. Please contact support.`,
            409
          );
        }
      }
    }

    const result = await sequelize.transaction(async (transaction) => {
      const locked = await orderService.loadAuthorizedOrder(order.id, req, { transaction });
      return orderService.applyStatusTransition({
        order: locked,
        toStatus: ORDER_STATUS.CANCELLED,
        req,
        transaction,
        reason: req.body.reason,
      });
    });

    await orderService.announceTransition({
      order: result.order,
      from: result.from,
      to: result.to,
      req,
      reason: req.body.reason,
    });

    const full = await orderService.loadAuthorizedOrder(result.order.id, req);
    return updated(res, orderService.serialize(full), 'Order cancelled successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error cancelling order', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        SALES AND FULFILMENT SUMMARY                        */
/* -------------------------------------------------------------------------- */
const summary = async (req, res) => {
  try {
    const where = {};
    if (!(await orderService.scopeOrders(where, req, req.body))) {
      return ok(
        res,
        {
          totalOrders: 0,
          deliveredOrders: 0,
          revenue: 0,
          averageOrderValue: 0,
          byStatus: {},
          cancellationRate: 0,
        },
        'Order summary fetched successfully'
      );
    }

    if (req.body.fromDate || req.body.toDate) {
      where.createdAt = {};
      if (req.body.fromDate) where.createdAt[Op.gte] = new Date(req.body.fromDate);
      if (req.body.toDate) where.createdAt[Op.lte] = new Date(req.body.toDate);
    }

    const [totalOrders, statusRows, revenueRow] = await Promise.all([
      Order.count({ where }),
      Order.findAll({
        where,
        attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true,
      }),
      Order.findOne({
        where: { ...where, status: ORDER_STATUS.DELIVERED },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('grand_total')), 'revenue'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'delivered'],
        ],
        raw: true,
      }),
    ]);

    const byStatus = statusRows.reduce((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});

    const revenue = money.round2(revenueRow?.revenue || 0);
    const delivered = Number(revenueRow?.delivered || 0);
    const cancelled = byStatus[ORDER_STATUS.CANCELLED] || 0;

    return ok(
      res,
      {
        totalOrders,
        deliveredOrders: delivered,
        revenue,
        averageOrderValue: delivered > 0 ? money.round2(revenue / delivered) : 0,
        byStatus,
        cancellationRate: totalOrders > 0 ? Math.round((cancelled / totalOrders) * 100) : 0,
      },
      'Order summary fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching order summary', 500, [{ message: error.message }]);
  }
};

module.exports = {
  checkout, list, detail, track, statusHistory, updateStatus, cancel, summary,
};
