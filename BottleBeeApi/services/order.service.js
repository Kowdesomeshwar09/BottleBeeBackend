'use strict';

const { Op } = require('sequelize');

const {
  Order, OrderItem, OrderStatusHistory, CustomerProfile, Vendor, Payment,
  DeliveryAssignment, DeliveryPartner, User, VendorUser,
} = require('../models');
const {
  ORDER_STATUS, ORDER_PAYMENT_STATUS, ORDER_DELIVERY_STATUS, PAYMENT_PROVIDER,
  PAYMENT_STATUS, ROLES, AUDIT_ACTIONS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const {
  assertOrderTransition, holdsReservation, allowedNextOrderStatuses,
} = require('../utils/orderStateMachine');
const { recordAudit } = require('../utils/audit');
const inventoryService = require('./inventory.service');
const promotionService = require('./promotion.service');
const notificationService = require('./notification.service');
const vendorAccessService = require('./vendorAccess.service');

/**
 * Order access and lifecycle transitions — SHARED SERVICE.
 *
 * Checkout, listing and reporting live in `order.controller.js`. What stays here
 * is what the payment, delivery and review controllers also need:
 *
 *   loadAuthorizedOrder   can this caller see this order?
 *   applyStatusTransition move it, with the side effects that must be atomic
 *
 * `applyStatusTransition` is the single driver of the order lifecycle. Payment
 * confirmation moves an order to CONFIRMED, a delivery partner moves it to
 * DELIVERED, a customer or admin moves it to CANCELLED — and each of those has
 * consequences for stock and coupons that must happen in the same transaction as
 * the status change. Duplicating it per controller is precisely how an order
 * ends up delivered with its stock still reserved, or cancelled with a coupon
 * still consumed.
 */

/* -------------------------------------------------------------------------- */
/*                               SERIALIZATION                                */
/* -------------------------------------------------------------------------- */

function serializeItem(item) {
  return {
    id: item.id,
    productId: item.productId,
    productVariantId: item.productVariantId,
    productName: item.productName,
    variantLabel: item.variantLabel,
    sku: item.sku,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    taxAmount: Number(item.taxAmount),
    discountAmount: Number(item.discountAmount),
    lineTotal: Number(item.lineTotal),
  };
}

function serialize(order, extra = {}) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    vendorId: order.vendorId,
    deliveryAddressId: order.deliveryAddressId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryStatus: order.deliveryStatus,
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discountTotal),
    taxTotal: Number(order.taxTotal),
    deliveryFee: Number(order.deliveryFee),
    grandTotal: Number(order.grandTotal),
    regionCode: order.regionCode,
    deliveryAddress: order.deliveryAddressSnapshot,
    customerNotes: order.customerNotes,
    cancellationReason: order.cancellationReason,
    cancelledAt: order.cancelledAt,
    confirmedAt: order.confirmedAt,
    deliveredAt: order.deliveredAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    allowedNextStatuses: allowedNextOrderStatuses(order.status),
    items: order.items ? order.items.map(serializeItem) : undefined,
    vendor: order.vendor
      ? {
        id: order.vendor.id,
        businessName: order.vendor.businessName,
        phone: order.vendor.phone,
      }
      : undefined,
    customer: order.customer
      ? {
        id: order.customer.id,
        legalName: typeof order.customer.legalName === 'function'
          ? order.customer.legalName()
          : null,
        userId: order.customer.userId,
        email: order.customer.user?.email,
        phone: order.customer.user?.phone,
      }
      : undefined,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */
/*                              ACCESS SCOPING                                */
/* -------------------------------------------------------------------------- */

/**
 * Narrows a query to the orders a caller may see: a customer sees their own, a
 * vendor user their stores', a delivery partner the ones assigned to them, and
 * staff everything. Returns false when the caller can see nothing at all.
 */
async function scopeOrders(where, req, body = {}) {
  if (vendorAccessService.isStaff(req)) {
    if (body.vendorId) where.vendorId = body.vendorId;
    if (body.customerId) where.customerId = body.customerId;
    return true;
  }

  if (req.user.roles.includes(ROLES.CUSTOMER)) {
    const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) return false;
    where.customerId = profile.id;
    return true;
  }

  if (req.user.roles.includes(ROLES.VENDOR_OWNER) || req.user.roles.includes(ROLES.VENDOR_MANAGER)) {
    const ids = await vendorAccessService.myVendorIds(req);
    if (!ids.length) return false;
    where.vendorId = body.vendorId && ids.includes(Number(body.vendorId))
      ? body.vendorId
      : { [Op.in]: ids };
    return true;
  }

  if (req.user.roles.includes(ROLES.DELIVERY_PARTNER)) {
    const partner = await DeliveryPartner.findOne({ where: { userId: req.user.id } });
    if (!partner) return false;

    const assignments = await DeliveryAssignment.findAll({
      where: { deliveryPartnerId: partner.id },
      attributes: ['orderId'],
    });
    if (!assignments.length) return false;

    where.id = { [Op.in]: assignments.map((a) => a.orderId) };
    return true;
  }

  return false;
}

/** The include set every full order response uses. */
const orderIncludes = [
  { model: OrderItem, as: 'items' },
  { model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'phone', 'ownerUserId'] },
  {
    model: CustomerProfile,
    as: 'customer',
    include: [{ model: User, as: 'user', attributes: ['id', 'email', 'phone', 'firstName'] }],
  },
];

/** Loads an order the caller is entitled to read, or throws 403/404. */
async function loadAuthorizedOrder(orderId, req, { transaction = null } = {}) {
  const order = await Order.findByPk(orderId, { include: orderIncludes, transaction });
  if (!order) throw AppError.notFound('Order not found');

  if (vendorAccessService.isStaff(req)) return order;

  if (req.user.roles.includes(ROLES.CUSTOMER)) {
    const profile = await CustomerProfile.findOne({
      where: { userId: req.user.id },
      transaction,
    });
    if (profile && Number(profile.id) === Number(order.customerId)) return order;
  }

  if (req.user.roles.includes(ROLES.VENDOR_OWNER) || req.user.roles.includes(ROLES.VENDOR_MANAGER)) {
    const membership = await VendorUser.findOne({
      where: { vendorId: order.vendorId, userId: req.user.id },
      transaction,
    });
    if (membership) return order;
  }

  if (req.user.roles.includes(ROLES.DELIVERY_PARTNER)) {
    const partner = await DeliveryPartner.findOne({
      where: { userId: req.user.id },
      transaction,
    });
    if (partner) {
      const assignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, deliveryPartnerId: partner.id },
        transaction,
      });
      if (assignment) return order;
    }
  }

  throw AppError.forbidden('You do not have access to this order');
}

/** Appends a status-history row. Always inside the caller's transaction. */
function recordStatusChange(order, fromStatus, toStatus, req, note, transaction) {
  return OrderStatusHistory.create(
    {
      orderId: order.id,
      fromStatus,
      toStatus,
      changedBy: req?.user?.id ?? null,
      note: note || null,
      createdBy: req?.user?.id ?? null,
    },
    { transaction }
  );
}

/* -------------------------------------------------------------------------- */
/*                          THE LIFECYCLE TRANSITION                          */
/* -------------------------------------------------------------------------- */

/**
 * Moves an order to a new status inside the caller's transaction, applying the
 * side effects that must be atomic with it.
 *
 *   -> DELIVERED  reserved stock becomes a sale; a cash order is marked paid
 *   -> CANCELLED  reserved stock is released and any coupon is un-redeemed
 *   -> CONFIRMED  the confirmation timestamp is stamped
 *
 * The transition graph and the roles permitted to drive it live in
 * utils/orderStateMachine, so no caller can invent a shortcut.
 *
 * @param {object} params
 * @param {object} params.order        loaded order, with items
 * @param {string} params.toStatus
 * @param {object} params.req
 * @param {object} params.transaction  REQUIRED
 * @param {string} [params.reason]     mandatory in spirit for cancellation
 * @param {string} [params.note]
 * @param {boolean} [params.skipRoleCheck] for system-driven transitions such as
 *                                         a payment webhook, which has no user
 */
async function applyStatusTransition({
  order, toStatus, req, transaction, reason = null, note = null, skipRoleCheck = false,
}) {
  if (!transaction) throw new Error('order.applyStatusTransition requires a transaction');

  const from = order.status;

  if (skipRoleCheck) {
    // Still validate the graph — only the actor check is bypassed.
    if (from === toStatus) {
      throw AppError.businessRule(`Order is already in status ${toStatus}`);
    }
    assertOrderTransition(from, toStatus, [ROLES.SUPER_ADMIN]);
  } else {
    assertOrderTransition(from, toStatus, req.user.roles);
  }

  const updates = { status: toStatus, updatedBy: req?.user?.id ?? null };

  if (toStatus === ORDER_STATUS.CONFIRMED) {
    updates.confirmedAt = new Date();
  }

  if (toStatus === ORDER_STATUS.DELIVERED) {
    // The legal hand-off gate: a delivery partner must have confirmed the
    // recipient's age and identity at the door.
    const assignment = await DeliveryAssignment.findOne({
      where: { orderId: order.id },
      transaction,
    });

    if (assignment && !assignment.recipientVerified) {
      throw AppError.compliance(
        "The recipient's age and identity must be verified before this order can be marked delivered.",
        [{ code: 'RECIPIENT_NOT_VERIFIED' }]
      );
    }

    updates.deliveredAt = new Date();
    updates.deliveryStatus = ORDER_DELIVERY_STATUS.DELIVERED;

    await inventoryService.commitSale(
      order.items.map((i) => ({ productVariantId: i.productVariantId, quantity: i.quantity })),
      {
        vendorId: order.vendorId,
        orderId: order.id,
        actorId: req?.user?.id ?? null,
        transaction,
      }
    );

    // Cash on delivery is collected at the door, so payment completes here.
    if (order.paymentStatus === ORDER_PAYMENT_STATUS.PENDING) {
      updates.paymentStatus = ORDER_PAYMENT_STATUS.PAID;
      await Payment.update(
        { status: PAYMENT_STATUS.CAPTURED, paidAt: new Date(), updatedBy: req?.user?.id ?? null },
        {
          where: { orderId: order.id, paymentProvider: PAYMENT_PROVIDER.CASH },
          transaction,
        }
      );
    }
  }

  if (toStatus === ORDER_STATUS.CANCELLED) {
    updates.cancelledAt = new Date();
    updates.cancelledBy = req?.user?.id ?? null;
    updates.cancellationReason = reason || 'Cancelled';
    updates.deliveryStatus = ORDER_DELIVERY_STATUS.CANCELLED;

    if (holdsReservation(from)) {
      await inventoryService.release(
        order.items.map((i) => ({ productVariantId: i.productVariantId, quantity: i.quantity })),
        {
          vendorId: order.vendorId,
          orderId: order.id,
          actorId: req?.user?.id ?? null,
          reason: `Order ${order.orderNumber} cancelled`,
          transaction,
        }
      );
    }

    await promotionService.releaseRedemption({
      orderId: order.id,
      actorId: req?.user?.id ?? null,
      transaction,
    });
  }

  await order.update(updates, { transaction });
  await recordStatusChange(order, from, toStatus, req, note || reason, transaction);

  return { order, from, to: toStatus };
}

/** Audit plus notifications for a completed transition. Call after commit. */
async function announceTransition({ order, from, to, req, reason = null }) {
  await recordAudit({
    action: to === ORDER_STATUS.CANCELLED
      ? AUDIT_ACTIONS.ORDER_CANCELLED
      : AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
    entityType: 'Order',
    entityId: order.id,
    oldValues: { status: from },
    newValues: { status: to, reason: reason || null },
    req,
  });

  await notifyStatusChange(order, to, reason);
}

/** Tells whoever cares about a particular transition. */
async function notifyStatusChange(order, status, reason) {
  const customerProfile = await CustomerProfile.findByPk(order.customerId, {
    attributes: ['userId'],
  });
  const vendor = await Vendor.findByPk(order.vendorId, {
    attributes: ['ownerUserId', 'businessName'],
  });

  const customerMessages = {
    [ORDER_STATUS.CONFIRMED]: `${vendor?.businessName} has confirmed order ${order.orderNumber}.`,
    [ORDER_STATUS.PREPARING]: `Your order ${order.orderNumber} is being prepared.`,
    [ORDER_STATUS.READY_FOR_PICKUP]: `Order ${order.orderNumber} is packed and waiting for a delivery partner.`,
    [ORDER_STATUS.ASSIGNED]: `A delivery partner has been assigned to order ${order.orderNumber}.`,
    [ORDER_STATUS.PICKED_UP]: `Your order ${order.orderNumber} has been picked up.`,
    [ORDER_STATUS.OUT_FOR_DELIVERY]: `Order ${order.orderNumber} is on its way. Please have your ID ready.`,
    [ORDER_STATUS.DELIVERED]: `Order ${order.orderNumber} has been delivered. Cheers!`,
    [ORDER_STATUS.CANCELLED]: `Order ${order.orderNumber} was cancelled.${reason ? ` Reason: ${reason}` : ''}`,
    [ORDER_STATUS.PAYMENT_FAILED]: `Payment for order ${order.orderNumber} failed. Please try again.`,
    [ORDER_STATUS.REFUNDED]: `Order ${order.orderNumber} has been refunded.`,
  };

  if (customerProfile && customerMessages[status]) {
    await notificationService.notify({
      userId: customerProfile.userId,
      templateCode: `ORDER_${status}`,
      title: `Order ${order.orderNumber}`,
      message: customerMessages[status],
      referenceType: 'Order',
      referenceId: order.id,
      actions: [{ label: 'View order', url: `/orders/${order.id}` }],
    });
  }

  // The store cares about cancellations and successful delivery.
  if (vendor && [ORDER_STATUS.CANCELLED, ORDER_STATUS.DELIVERED].includes(status)) {
    await notificationService.notify({
      userId: vendor.ownerUserId,
      templateCode: `ORDER_${status}_VENDOR`,
      title: `Order ${order.orderNumber} ${status.toLowerCase()}`,
      message: status === ORDER_STATUS.CANCELLED
        ? `Order ${order.orderNumber} was cancelled.${reason ? ` Reason: ${reason}` : ''} Reserved stock has been returned.`
        : `Order ${order.orderNumber} was delivered successfully.`,
      referenceType: 'Order',
      referenceId: order.id,
    });
  }
}

module.exports = {
  serialize,
  serializeItem,
  orderIncludes,
  scopeOrders,
  loadAuthorizedOrder,
  recordStatusChange,
  applyStatusTransition,
  announceTransition,
  notifyStatusChange,
};
