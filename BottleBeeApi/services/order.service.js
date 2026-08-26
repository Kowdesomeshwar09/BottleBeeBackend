'use strict';

const { Op, UniqueConstraintError } = require('sequelize');

const config = require('../config');
const logger = require('../config/logger');
const {
  sequelize, Order, OrderItem, OrderStatusHistory, Cart, CartItem, CustomerProfile,
  CustomerAddress, Vendor, Product, ProductVariant, Payment, Refund, DeliveryAssignment,
  DeliveryPartner, User, VendorUser,
} = require('../models');
const {
  ORDER_STATUS, ORDER_PAYMENT_STATUS, ORDER_DELIVERY_STATUS, CART_STATUS,
  PAYMENT_PROVIDER, ROLES, VENDOR_ROLE, AUDIT_ACTIONS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { generateOrderNumber } = require('../utils/orderNumber');
const {
  assertOrderTransition, assertCustomerMayCancel, holdsReservation, allowedNextOrderStatuses,
} = require('../utils/orderStateMachine');
const { recordAudit } = require('../utils/audit');
const money = require('../utils/money');
const cartService = require('./cart.service');
const pricingService = require('./pricing.service');
const promotionService = require('./promotion.service');
const inventoryService = require('./inventory.service');
const complianceService = require('./compliance.service');
const vendorService = require('./vendor.service');
const notificationService = require('./notification.service');

/**
 * Checkout and the order lifecycle.
 *
 * Checkout is a single database transaction. Everything that must be true for a
 * legal alcohol sale is re-checked inside it, from the server's own data:
 *
 *   1  the caller has a customer profile
 *   2  age verification is approved
 *   3  the cart is not empty
 *   4  every item belongs to one vendor (single-vendor by design)
 *   5  the delivery address belongs to the caller
 *   6  the vendor is APPROVED and holds a valid licence for the delivery region
 *   7  regional compliance passes (age, dry day, sale window, quantity and value caps)
 *   8  stock is available and is reserved atomically
 *   9  totals are recomputed server-side — the client sends no prices
 *  10  the coupon is re-validated and redeemed under its usage limits
 *  11  the order, its items and its first history row are written together
 *  12  the cart is marked ORDERED only after the order exists
 *
 * If any step fails the whole transaction rolls back, so a rejected checkout
 * never leaves stock reserved, a coupon consumed or a half-written order.
 */

const SORTABLE = ['id', 'orderNumber', 'status', 'grandTotal', 'createdAt', 'deliveredAt'];

/** How many times to retry when a random order number collides. */
const ORDER_NUMBER_RETRIES = 3;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

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
      ? { id: order.vendor.id, businessName: order.vendor.businessName, phone: order.vendor.phone }
      : undefined,
    customer: order.customer
      ? {
        id: order.customer.id,
        legalName: typeof order.customer.legalName === 'function' ? order.customer.legalName() : null,
        userId: order.customer.userId,
        email: order.customer.user?.email,
        phone: order.customer.user?.phone,
      }
      : undefined,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Access scoping
// ---------------------------------------------------------------------------

/**
 * Restricts a query to the orders the caller may see.
 * A customer sees their own, a vendor user sees their stores', staff see all.
 */
async function scopeOrders(where, req, body = {}) {
  const isStaff = req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);

  if (isStaff) {
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
    const ids = await vendorService.myVendorIds(req);
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

/** Loads an order the caller is entitled to read, or throws. */
async function loadAuthorizedOrder(orderId, req, { transaction = null, forUpdate = false } = {}) {
  const order = await Order.findByPk(orderId, {
    include: [
      { model: OrderItem, as: 'items' },
      { model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'phone', 'ownerUserId'] },
      {
        model: CustomerProfile,
        as: 'customer',
        include: [{ model: User, as: 'user', attributes: ['id', 'email', 'phone', 'firstName'] }],
      },
    ],
    transaction,
    ...(forUpdate ? { lock: transaction ? transaction.LOCK.UPDATE : undefined } : {}),
  });

  if (!order) throw AppError.notFound('Order not found');

  const isStaff = req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);
  if (isStaff) return order;

  if (req.user.roles.includes(ROLES.CUSTOMER)) {
    const profile = await CustomerProfile.findOne({ where: { userId: req.user.id }, transaction });
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
    const partner = await DeliveryPartner.findOne({ where: { userId: req.user.id }, transaction });
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

/** Writes a status-history row. Always inside the caller's transaction. */
async function recordStatusChange(order, fromStatus, toStatus, req, note, transaction) {
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

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * Turns the caller's cart into an order.
 *
 * `paymentMethod` decides the starting status: CASH (pay on delivery) goes
 * straight to CONFIRMED because there is nothing to collect online, anything
 * else goes to PAYMENT_PENDING and waits for the payment module.
 */
async function checkout(body, req) {
  let attempt = 0;

  /* eslint-disable no-await-in-loop */
  while (attempt < ORDER_NUMBER_RETRIES) {
    attempt += 1;
    try {
      return await runCheckout(body, req);
    } catch (err) {
      // The order number is random, so a collision is possible but rare; retry
      // with a fresh number rather than failing the customer's checkout.
      const isOrderNumberClash = err instanceof UniqueConstraintError
        && (err.errors || []).some((e) => e.path === 'order_number' || e.path === 'orderNumber');

      if (isOrderNumberClash && attempt < ORDER_NUMBER_RETRIES) {
        logger.warn('Order number collision on attempt %s — retrying', attempt);
        continue;
      }
      throw err;
    }
  }
  /* eslint-enable no-await-in-loop */

  throw AppError.internal('Could not allocate an order number. Please try again.');
}

async function runCheckout(body, req) {
  const result = await sequelize.transaction(async (transaction) => {
    // --- 1. Customer -----------------------------------------------------
    const profile = await CustomerProfile.findOne({
      where: { userId: req.user.id },
      transaction,
    });
    if (!profile) {
      throw AppError.businessRule('Complete your customer profile before placing an order');
    }

    // --- 2. Cart ---------------------------------------------------------
    const cart = await Cart.findOne({
      where: { customerId: profile.id, status: CART_STATUS.ACTIVE },
      order: [['createdAt', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!cart) throw AppError.businessRule('Your cart is empty');

    const items = await cartService.loadItems(cart.id, { transaction });
    if (!items.length) throw AppError.businessRule('Your cart is empty');

    // --- 3. Single vendor -------------------------------------------------
    const vendorIds = [...new Set(items.map((i) => Number(i.variant.product.vendorId)))];
    if (vendorIds.length > 1) {
      throw AppError.businessRule(
        'Your cart contains items from more than one store. Bottle Bee delivers from one store per order.',
        [{ code: 'MIXED_VENDOR_CART', vendorIds }]
      );
    }
    const vendorId = vendorIds[0];

    // --- 4. Delivery address --------------------------------------------
    const addressId = body.deliveryAddressId || profile.defaultAddressId;
    if (!addressId) {
      throw AppError.badRequest('Choose a delivery address', [
        { field: 'deliveryAddressId', message: 'Required' },
      ]);
    }

    const address = await CustomerAddress.findOne({
      where: { id: addressId, customerId: profile.id },
      transaction,
    });
    if (!address) throw AppError.notFound('That delivery address was not found on your account');

    // --- 5. Products still purchasable ----------------------------------
    const unavailable = items.filter((item) => !cartService.serializeItem(item).isPurchasable);
    if (unavailable.length) {
      throw AppError.businessRule(
        'Some items in your cart are no longer available. Please review your cart.',
        unavailable.map((item) => ({
          code: 'ITEM_UNAVAILABLE',
          cartItemId: item.id,
          productName: item.variant?.product?.name,
        }))
      );
    }

    // --- 6. Totals, computed server-side --------------------------------
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

    // --- 7. Vendor minimum order ----------------------------------------
    const vendor = await Vendor.findByPk(vendorId, { transaction });
    if (vendor?.minOrderAmount && totals.subtotal < Number(vendor.minOrderAmount)) {
      throw AppError.businessRule(
        `${vendor.businessName} has a minimum order value of ${vendor.minOrderAmount}.`,
        [{ code: 'BELOW_MINIMUM_ORDER', minOrderAmount: Number(vendor.minOrderAmount), subtotal: totals.subtotal }]
      );
    }

    // --- 8. Compliance ---------------------------------------------------
    const complianceReport = await complianceService.assertOrderCompliant({
      address,
      dateOfBirth: profile.dateOfBirth,
      ageVerified: profile.ageVerified,
      totalQuantity: totals.totalQuantity,
      grandTotal: totals.grandTotal,
      productTypes: items.map((i) => i.variant.product.productType),
    });

    // --- 9. Vendor licence for this region ------------------------------
    await vendorService.assertOperational(vendorId, complianceReport.regionCode, { transaction });

    // --- 10. Order -------------------------------------------------------
    const paymentMethod = body.paymentMethod || PAYMENT_PROVIDER.RAZORPAY;
    const isCashOnDelivery = paymentMethod === PAYMENT_PROVIDER.CASH;

    const initialStatus = isCashOnDelivery ? ORDER_STATUS.CONFIRMED : ORDER_STATUS.PAYMENT_PENDING;

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
        deliveryAddressSnapshot: address.toSnapshot(),
        regionCode: complianceReport.regionCode,
        customerNotes: body.customerNotes || null,
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

    // --- 11. Reserve stock ----------------------------------------------
    // Atomic and guarded: a losing race here aborts the whole checkout.
    await inventoryService.reserve(
      totals.lines.map((l) => ({ productVariantId: l.productVariantId, quantity: l.quantity })),
      { vendorId, orderId: order.id, actorId: req.user.id, transaction }
    );

    // --- 12. Redeem coupon ----------------------------------------------
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

    // --- 13. History and cart -------------------------------------------
    await recordStatusChange(
      order, null, initialStatus, req,
      isCashOnDelivery ? 'Order placed, cash on delivery' : 'Order placed, awaiting payment',
      transaction
    );

    // Only now is the cart consumed.
    await cart.update(
      { status: CART_STATUS.ORDERED, updatedBy: req.user.id },
      { transaction }
    );

    return { order, vendor, coupon, totals, complianceReport, paymentMethod, isCashOnDelivery };
  });

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

  return detail({ id: result.order.id }, req);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function list(body, req) {
  const { page, limit, offset, order } = buildPagination(body, { sortable: SORTABLE });

  const where = {};
  if (!(await scopeOrders(where, req, body))) {
    return { rows: [], meta: { page, limit, total: 0 } };
  }

  if (body.status) where.status = { [Op.in]: [].concat(body.status) };
  if (body.paymentStatus) where.paymentStatus = body.paymentStatus;
  if (body.deliveryStatus) where.deliveryStatus = body.deliveryStatus;
  if (body.orderNumber) where.orderNumber = { [Op.like]: `%${body.orderNumber}%` };
  if (body.search) where.orderNumber = { [Op.like]: `%${body.search}%` };

  if (body.fromDate || body.toDate) {
    where.createdAt = {};
    if (body.fromDate) where.createdAt[Op.gte] = new Date(body.fromDate);
    if (body.toDate) where.createdAt[Op.lte] = new Date(body.toDate);
  }

  const result = await Order.findAndCountAll({
    where,
    include: [
      { model: OrderItem, as: 'items' },
      { model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'phone'] },
      {
        model: CustomerProfile,
        as: 'customer',
        include: [{ model: User, as: 'user', attributes: ['id', 'email', 'phone', 'firstName'] }],
      },
    ],
    limit,
    offset,
    order,
    distinct: true,
  });

  return { rows: result.rows.map((o) => serialize(o)), meta: toPageMeta(result, { page, limit }) };
}

async function detail(body, req) {
  const order = await loadAuthorizedOrder(body.id, req);

  const [history, payments, assignment, refunds] = await Promise.all([
    OrderStatusHistory.findAll({
      where: { orderId: order.id },
      include: [{ model: User, as: 'actor', attributes: ['id', 'firstName', 'lastName'], required: false }],
      order: [['createdAt', 'ASC']],
    }),
    Payment.findAll({ where: { orderId: order.id }, order: [['createdAt', 'DESC']] }),
    DeliveryAssignment.findOne({
      where: { orderId: order.id },
      include: [{
        model: DeliveryPartner,
        as: 'partner',
        include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'phone'] }],
      }],
    }),
    Refund.findAll({ where: { orderId: order.id }, order: [['createdAt', 'DESC']] }),
  ]);

  return serialize(order, {
    statusHistory: history.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      changedAt: h.createdAt,
      changedBy: h.actor ? [h.actor.firstName, h.actor.lastName].filter(Boolean).join(' ') : 'System',
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
              ? [assignment.partner.user.firstName, assignment.partner.user.lastName].filter(Boolean).join(' ')
              : null,
            // The rider's number is shown only while a delivery is live.
            phone: [ORDER_STATUS.PICKED_UP, ORDER_STATUS.OUT_FOR_DELIVERY].includes(order.status)
              ? assignment.partner.user?.phone
              : null,
            vehicleType: assignment.partner.vehicleType,
            vehicleNumber: assignment.partner.vehicleNumber,
            ratingAvg: Number(assignment.partner.ratingAvg || 0),
          }
          : null,
      }
      : null,
  });
}

/** Lightweight tracking view, for the customer's order-tracking screen. */
async function track(body, req) {
  const where = body.orderNumber ? { orderNumber: body.orderNumber } : { id: body.id };

  const order = await Order.findOne({ where, attributes: ['id'] });
  if (!order) throw AppError.notFound('Order not found');

  const full = await detail({ id: order.id }, req);

  return {
    orderNumber: full.orderNumber,
    status: full.status,
    paymentStatus: full.paymentStatus,
    deliveryStatus: full.deliveryStatus,
    grandTotal: full.grandTotal,
    placedAt: full.createdAt,
    confirmedAt: full.confirmedAt,
    deliveredAt: full.deliveredAt,
    vendor: full.vendor,
    deliveryAddress: full.deliveryAddress,
    itemCount: full.items?.length ?? 0,
    statusHistory: full.statusHistory,
    delivery: full.delivery,
  };
}

async function statusHistory(body, req) {
  const order = await loadAuthorizedOrder(body.id, req);

  const { page, limit, offset, order: ordering } = buildPagination(body, {
    sortable: ['id', 'createdAt'],
    defaultSort: 'createdAt',
    defaultOrder: 'ASC',
  });

  const result = await OrderStatusHistory.findAndCountAll({
    where: { orderId: order.id },
    include: [{ model: User, as: 'actor', attributes: ['id', 'firstName', 'lastName'], required: false }],
    limit,
    offset,
    order: ordering,
  });

  return {
    rows: result.rows.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      changedAt: h.createdAt,
      changedBy: h.actor ? [h.actor.firstName, h.actor.lastName].filter(Boolean).join(' ') : 'System',
    })),
    meta: toPageMeta(result, { page, limit }),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Moves an order to a new status.
 *
 * The transition graph and the role allowed to drive it both live in
 * utils/orderStateMachine, so no endpoint can invent a shortcut. Side effects
 * that must happen atomically with the status change happen here:
 *
 *   -> DELIVERED  reserved stock becomes a sale, COD is marked paid
 *   -> CANCELLED  reserved stock is released and any coupon is un-redeemed
 */
async function updateStatus(body, req) {
  const result = await sequelize.transaction(async (transaction) => {
    const order = await loadAuthorizedOrder(body.id, req, { transaction });
    const from = order.status;
    const to = body.status;

    assertOrderTransition(from, to, req.user.roles);

    // A vendor user may only drive their own store's orders.
    if (req.user.roles.includes(ROLES.VENDOR_OWNER) || req.user.roles.includes(ROLES.VENDOR_MANAGER)) {
      await vendorService.assertVendorAccess(order.vendorId, req, {
        requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER],
      });
    }

    const updates = { status: to, updatedBy: req.user.id };

    if (to === ORDER_STATUS.CONFIRMED) updates.confirmedAt = new Date();

    if (to === ORDER_STATUS.DELIVERED) {
      // Delivery requires a completed recipient check: this is the legal
      // hand-off gate, not a formality.
      const assignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id },
        transaction,
      });
      if (assignment && !assignment.recipientVerified) {
        throw AppError.compliance(
          'The recipient\'s age and identity must be verified before this order can be marked delivered.',
          [{ code: 'RECIPIENT_NOT_VERIFIED' }]
        );
      }

      updates.deliveredAt = new Date();
      updates.deliveryStatus = ORDER_DELIVERY_STATUS.DELIVERED;

      await inventoryService.commitSale(
        order.items.map((i) => ({ productVariantId: i.productVariantId, quantity: i.quantity })),
        { vendorId: order.vendorId, orderId: order.id, actorId: req.user.id, transaction }
      );

      // Cash on delivery is collected at the door, so payment completes here.
      if (order.paymentStatus === ORDER_PAYMENT_STATUS.PENDING) {
        updates.paymentStatus = ORDER_PAYMENT_STATUS.PAID;
        await Payment.update(
          { status: 'CAPTURED', paidAt: new Date(), updatedBy: req.user.id },
          { where: { orderId: order.id, paymentProvider: PAYMENT_PROVIDER.CASH }, transaction }
        );
      }
    }

    if (to === ORDER_STATUS.CANCELLED) {
      updates.cancelledAt = new Date();
      updates.cancelledBy = req.user.id;
      updates.cancellationReason = body.reason || 'Cancelled';
      updates.deliveryStatus = ORDER_DELIVERY_STATUS.CANCELLED;

      if (holdsReservation(from)) {
        await inventoryService.release(
          order.items.map((i) => ({ productVariantId: i.productVariantId, quantity: i.quantity })),
          {
            vendorId: order.vendorId,
            orderId: order.id,
            actorId: req.user.id,
            reason: `Order ${order.orderNumber} cancelled`,
            transaction,
          }
        );
      }

      await promotionService.releaseRedemption({
        orderId: order.id,
        actorId: req.user.id,
        transaction,
      });
    }

    await order.update(updates, { transaction });
    await recordStatusChange(order, from, to, req, body.note || body.reason, transaction);

    return { order, from, to };
  });

  await recordAudit({
    action: result.to === ORDER_STATUS.CANCELLED
      ? AUDIT_ACTIONS.ORDER_CANCELLED
      : AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
    entityType: 'Order',
    entityId: result.order.id,
    oldValues: { status: result.from },
    newValues: { status: result.to, note: body.note || body.reason || null },
    req,
  });

  await notifyStatusChange(result.order, result.to, body.reason || body.note);

  return detail({ id: result.order.id }, req);
}

/** Customer-initiated cancellation, with its own narrower window. */
async function cancel(body, req) {
  const order = await loadAuthorizedOrder(body.id, req);

  const isCustomer = req.user.roles.includes(ROLES.CUSTOMER)
    && !req.user.isSuperAdmin
    && !req.user.roles.includes(ROLES.ADMIN);

  if (isCustomer) {
    assertCustomerMayCancel(order.status);

    // Once a vendor has confirmed, a short grace period applies: after that the
    // store may already have begun picking the order.
    if (order.status === ORDER_STATUS.CONFIRMED && order.confirmedAt) {
      const elapsedMinutes = (Date.now() - new Date(order.confirmedAt).getTime()) / 60000;
      if (elapsedMinutes > config.fulfilment.cancellationWindowMinutes) {
        throw AppError.businessRule(
          `This order was confirmed more than ${config.fulfilment.cancellationWindowMinutes} minutes ago and can no longer be cancelled. Please contact support.`
        );
      }
    }
  }

  return updateStatus(
    { id: order.id, status: ORDER_STATUS.CANCELLED, reason: body.reason },
    req
  );
}

/** Notifies whoever cares about a particular transition. */
async function notifyStatusChange(order, status, reason) {
  const customerProfile = await CustomerProfile.findByPk(order.customerId, { attributes: ['userId'] });
  const vendor = await Vendor.findByPk(order.vendorId, { attributes: ['ownerUserId', 'businessName'] });

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

/**
 * Sales and fulfilment summary for the vendor or admin dashboard.
 */
async function summary(body, req) {
  const where = {};
  if (!(await scopeOrders(where, req, body))) {
    return {
      totalOrders: 0, revenue: 0, averageOrderValue: 0, byStatus: {}, cancellationRate: 0,
    };
  }

  if (body.fromDate || body.toDate) {
    where.createdAt = {};
    if (body.fromDate) where.createdAt[Op.gte] = new Date(body.fromDate);
    if (body.toDate) where.createdAt[Op.lte] = new Date(body.toDate);
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

  return {
    totalOrders,
    deliveredOrders: delivered,
    revenue,
    averageOrderValue: delivered > 0 ? money.round2(revenue / delivered) : 0,
    byStatus,
    cancellationRate: totalOrders > 0 ? Math.round((cancelled / totalOrders) * 100) : 0,
  };
}

module.exports = {
  checkout,
  list,
  detail,
  track,
  statusHistory,
  updateStatus,
  cancel,
  summary,
  loadAuthorizedOrder,
  recordStatusChange,
  scopeOrders,
  serialize,
  notifyStatusChange,
};
