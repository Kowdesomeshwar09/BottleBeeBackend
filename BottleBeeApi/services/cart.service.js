'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const {
  sequelize, Cart, CartItem, ProductVariant, Product, Vendor, Inventory, CustomerAddress,
} = require('../models');
const {
  CART_STATUS, PRODUCT_STATUS, VARIANT_STATUS, VENDOR_STATUS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const customerService = require('./customer.service');
const pricingService = require('./pricing.service');
const promotionService = require('./promotion.service');
const inventoryService = require('./inventory.service');
const complianceService = require('./compliance.service');
const vendorService = require('./vendor.service');

/**
 * The shopping cart.
 *
 * A cart is single-vendor by design: Bottle Bee delivers from one licensed store
 * per order, so the first item pins `vendorId` and items from another store are
 * refused until the cart is cleared. Totals are recomputed from the database on
 * every mutation through the shared pricing engine — the client never supplies
 * a price or a total.
 *
 * Cart items are soft-deleted, and `(cart_id, product_variant_id)` is unique, so
 * re-adding a removed item restores the existing row rather than colliding
 * with it.
 */

/** Loads the caller's live cart, creating one on demand. */
async function getOrCreateCart(req, { transaction = null } = {}) {
  const profile = await customerService.requireProfile(req.user.id, { transaction });

  const existing = await Cart.findOne({
    where: { customerId: profile.id, status: CART_STATUS.ACTIVE },
    order: [['createdAt', 'DESC']],
    transaction,
  });

  if (existing) return { cart: existing, profile };

  const cart = await Cart.create(
    { customerId: profile.id, status: CART_STATUS.ACTIVE, createdBy: req.user.id },
    { transaction }
  );

  return { cart, profile };
}

/** Cart items joined to the catalog, in the shape the pricing engine expects. */
async function loadItems(cartId, { transaction = null } = {}) {
  const items = await CartItem.findAll({
    where: { cartId },
    include: [{
      model: ProductVariant,
      as: 'variant',
      required: true,
      include: [
        {
          model: Product,
          as: 'product',
          required: true,
          include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'status', 'minOrderAmount'] }],
        },
        { model: Inventory, as: 'inventory', required: false },
      ],
    }],
    order: [['createdAt', 'ASC']],
    transaction,
  });

  return items;
}

/**
 * Recomputes and persists the five cart totals.
 * Called after every mutation so the stored totals are never stale.
 */
async function recalculate(cart, { transaction = null, req = null } = {}) {
  const items = await loadItems(cart.id, { transaction });

  let coupon = null;
  let couponError = null;

  if (cart.couponId) {
    // Re-validate on every recalculation: a coupon can expire, or the cart can
    // fall below its minimum, between adding it and checking out.
    const subtotalForCoupon = items.reduce(
      (sum, item) => sum + Number(item.variant.sellingPrice) * item.quantity,
      0
    );

    try {
      const validated = await promotionService.validateForCart({
        code: cart.couponCode,
        userId: req?.user?.id ?? null,
        subtotal: subtotalForCoupon,
        vendorId: cart.vendorId,
        transaction,
      });
      coupon = validated.coupon;
    } catch (err) {
      // Drop the coupon rather than blocking the cart, and tell the customer.
      couponError = err.message;
      coupon = null;
    }
  }

  const totals = pricingService.computeTotals(
    items.map((item) => ({
      cartItemId: item.id,
      productVariantId: item.productVariantId,
      quantity: item.quantity,
      // Always price from the catalog, never from the stored cart row: a price
      // change must be reflected before the customer pays.
      unitPrice: Number(item.variant.sellingPrice),
      taxPercent: Number(item.variant.taxPercent || 0),
    })),
    { coupon }
  );

  // Persist the recomputed line prices so the cart row and the catalog agree.
  for (const line of totals.lines) {
    // eslint-disable-next-line no-await-in-loop
    await CartItem.update(
      { unitPrice: line.unitPrice, lineTotal: line.lineTotal, updatedBy: req?.user?.id ?? null },
      { where: { id: line.cartItemId }, transaction }
    );
  }

  await cart.update(
    {
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      deliveryFee: totals.deliveryFee,
      grandTotal: totals.grandTotal,
      couponId: coupon ? coupon.id : null,
      couponCode: coupon ? coupon.code : null,
      updatedBy: req?.user?.id ?? null,
    },
    { transaction }
  );

  return { items, totals, coupon, couponError };
}

function serializeItem(item, line = null) {
  const variant = item.variant;
  const product = variant?.product;
  const inventory = variant?.inventory;

  return {
    id: item.id,
    productVariantId: item.productVariantId,
    productId: product?.id,
    productName: product?.name,
    productType: product?.productType,
    variantLabel: typeof variant?.label === 'function' ? variant.label() : null,
    sku: variant?.sku,
    sizeMl: variant?.sizeMl,
    packSize: variant?.packSize,
    quantity: item.quantity,
    unitPrice: line ? line.unitPrice : Number(item.unitPrice),
    mrp: variant ? Number(variant.mrp) : null,
    discountAmount: line ? line.discountAmount : 0,
    taxAmount: line ? line.taxAmount : 0,
    lineTotal: line ? line.lineTotal : Number(item.lineTotal),
    availableQuantity: inventory ? inventory.quantityAvailable : null,
    inStock: inventory ? inventory.quantityAvailable >= item.quantity : false,
    isPurchasable: !!(product?.status === PRODUCT_STATUS.ACTIVE
      && variant?.status === VARIANT_STATUS.ACTIVE
      && product?.vendor?.status === VENDOR_STATUS.APPROVED),
  };
}

function serializeCart(cart, { items = [], totals = null, coupon = null, couponError = null, vendor = null, warnings = [] } = {}) {
  const linesById = new Map((totals?.lines || []).map((l) => [l.cartItemId, l]));

  return {
    id: cart.id,
    customerId: cart.customerId,
    vendorId: cart.vendorId,
    status: cart.status,
    vendor: vendor
      ? {
        id: vendor.id,
        businessName: vendor.businessName,
        status: vendor.status,
        minOrderAmount: vendor.minOrderAmount === null ? null : Number(vendor.minOrderAmount),
      }
      : null,
    coupon: coupon
      ? {
        id: coupon.id,
        code: coupon.code,
        title: coupon.title,
        discountType: coupon.discountType,
        discountValue: Number(coupon.discountValue),
      }
      : null,
    couponError,
    items: items.map((item) => serializeItem(item, linesById.get(item.id))),
    itemCount: items.length,
    totalQuantity: totals?.totalQuantity ?? items.reduce((sum, i) => sum + i.quantity, 0),
    subtotal: Number(cart.subtotal),
    discountTotal: Number(cart.discountTotal),
    taxTotal: Number(cart.taxTotal),
    deliveryFee: Number(cart.deliveryFee),
    grandTotal: Number(cart.grandTotal),
    freeDeliveryThreshold: totals?.freeDeliveryThreshold ?? config.fulfilment.freeDeliveryAbove,
    amountToFreeDelivery: totals?.amountToFreeDelivery ?? 0,
    warnings,
    updatedAt: cart.updatedAt,
  };
}

/** Flags anything that would block checkout, so the cart screen can explain it. */
function collectWarnings(items, vendor) {
  const warnings = [];

  items.forEach((item) => {
    const product = item.variant?.product;
    const available = item.variant?.inventory?.quantityAvailable ?? 0;

    if (product?.status !== PRODUCT_STATUS.ACTIVE) {
      warnings.push({
        code: 'PRODUCT_UNAVAILABLE',
        cartItemId: item.id,
        message: `${product?.name || 'An item'} is no longer available.`,
      });
    } else if (item.variant?.status !== VARIANT_STATUS.ACTIVE) {
      warnings.push({
        code: 'VARIANT_UNAVAILABLE',
        cartItemId: item.id,
        message: `${product.name} (${item.variant.sku}) is no longer available.`,
      });
    } else if (available < item.quantity) {
      warnings.push({
        code: 'INSUFFICIENT_STOCK',
        cartItemId: item.id,
        message: `Only ${available} unit(s) of ${product.name} are left.`,
        available,
        requested: item.quantity,
      });
    }
  });

  if (vendor && vendor.status !== VENDOR_STATUS.APPROVED) {
    warnings.push({
      code: 'VENDOR_UNAVAILABLE',
      message: `${vendor.businessName} is not currently accepting orders.`,
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

async function getCart(req) {
  const { cart } = await getOrCreateCart(req);
  const { items, totals, coupon, couponError } = await recalculate(cart, { req });

  const vendor = cart.vendorId ? await Vendor.findByPk(cart.vendorId) : null;

  return serializeCart(cart, {
    items,
    totals,
    coupon,
    couponError,
    vendor,
    warnings: collectWarnings(items, vendor),
  });
}

async function addItem(body, req) {
  const result = await sequelize.transaction(async (transaction) => {
    const { cart } = await getOrCreateCart(req, { transaction });

    const variant = await ProductVariant.findByPk(body.productVariantId, {
      include: [{
        model: Product,
        as: 'product',
        include: [{ model: Vendor, as: 'vendor' }],
      }],
      transaction,
    });

    if (!variant) throw AppError.notFound('That product option does not exist');

    const product = variant.product;
    if (!product) throw AppError.notFound('Parent product not found');

    if (product.status !== PRODUCT_STATUS.ACTIVE || !product.isActive) {
      throw AppError.businessRule('This product is not available for purchase');
    }
    if (variant.status !== VARIANT_STATUS.ACTIVE || !variant.isActive) {
      throw AppError.businessRule('This product option is not available for purchase');
    }
    if (!product.vendor || product.vendor.status !== VENDOR_STATUS.APPROVED || !product.vendor.isActive) {
      throw AppError.businessRule('This store is not currently accepting orders');
    }

    // One order, one licensed store.
    if (cart.vendorId && Number(cart.vendorId) !== Number(product.vendorId)) {
      const currentVendor = await Vendor.findByPk(cart.vendorId, {
        attributes: ['businessName'],
        transaction,
      });
      throw AppError.businessRule(
        `Your cart already contains items from ${currentVendor?.businessName || 'another store'}. Bottle Bee delivers from one store per order — clear your cart to shop here instead.`,
        [{ code: 'MIXED_VENDOR_CART', currentVendorId: Number(cart.vendorId), attemptedVendorId: Number(product.vendorId) }]
      );
    }

    // The unique key survives a soft delete, so a previously removed line is
    // restored rather than duplicated.
    const existing = await CartItem.findOne({
      where: { cartId: cart.id, productVariantId: variant.id },
      paranoid: false,
      transaction,
    });

    const requestedQuantity = existing && !existing.deletedAt
      ? existing.quantity + body.quantity
      : body.quantity;

    const inventory = await Inventory.findOne({
      where: { vendorId: product.vendorId, productVariantId: variant.id },
      transaction,
    });
    const available = inventory?.quantityAvailable ?? 0;

    if (available < requestedQuantity) {
      throw AppError.conflict(
        available === 0
          ? `${product.name} is out of stock.`
          : `Only ${available} unit(s) of ${product.name} are available.`,
        [{ code: 'INSUFFICIENT_STOCK', available, requested: requestedQuantity }]
      );
    }

    if (existing) {
      if (existing.deletedAt) await existing.restore({ transaction });
      await existing.update(
        {
          quantity: requestedQuantity,
          unitPrice: variant.sellingPrice,
          lineTotal: Number(variant.sellingPrice) * requestedQuantity,
          isActive: true,
          updatedBy: req.user.id,
        },
        { transaction }
      );
    } else {
      await CartItem.create(
        {
          cartId: cart.id,
          productVariantId: variant.id,
          quantity: requestedQuantity,
          unitPrice: variant.sellingPrice,
          lineTotal: Number(variant.sellingPrice) * requestedQuantity,
          createdBy: req.user.id,
        },
        { transaction }
      );
    }

    if (!cart.vendorId) {
      await cart.update({ vendorId: product.vendorId, updatedBy: req.user.id }, { transaction });
    }

    return cart;
  });

  return getCart(req);
}

async function updateItem(body, req) {
  await sequelize.transaction(async (transaction) => {
    const { cart } = await getOrCreateCart(req, { transaction });

    const item = await CartItem.findOne({
      where: { id: body.id, cartId: cart.id },
      include: [{ model: ProductVariant, as: 'variant', include: [{ model: Product, as: 'product' }] }],
      transaction,
    });
    if (!item) throw AppError.notFound('That item is not in your cart');

    const inventory = await Inventory.findOne({
      where: { vendorId: item.variant.product.vendorId, productVariantId: item.productVariantId },
      transaction,
    });
    const available = inventory?.quantityAvailable ?? 0;

    if (available < body.quantity) {
      throw AppError.conflict(
        `Only ${available} unit(s) of ${item.variant.product.name} are available.`,
        [{ code: 'INSUFFICIENT_STOCK', available, requested: body.quantity }]
      );
    }

    await item.update(
      {
        quantity: body.quantity,
        unitPrice: item.variant.sellingPrice,
        lineTotal: Number(item.variant.sellingPrice) * body.quantity,
        updatedBy: req.user.id,
      },
      { transaction }
    );
  });

  return getCart(req);
}

async function removeItem(body, req) {
  await sequelize.transaction(async (transaction) => {
    const { cart } = await getOrCreateCart(req, { transaction });

    const item = await CartItem.findOne({ where: { id: body.id, cartId: cart.id }, transaction });
    if (!item) throw AppError.notFound('That item is not in your cart');

    await item.update({ deletedBy: req.user.id }, { transaction });
    await item.destroy({ transaction });

    // Releasing the vendor pin lets the customer shop elsewhere once the cart
    // is empty, without an explicit clear.
    const remaining = await CartItem.count({ where: { cartId: cart.id }, transaction });
    if (remaining === 0) {
      await cart.update(
        { vendorId: null, couponId: null, couponCode: null, updatedBy: req.user.id },
        { transaction }
      );
    }
  });

  return getCart(req);
}

async function clearCart(req) {
  await sequelize.transaction(async (transaction) => {
    const { cart } = await getOrCreateCart(req, { transaction });

    await CartItem.update(
      { deletedBy: req.user.id },
      { where: { cartId: cart.id }, transaction }
    );
    await CartItem.destroy({ where: { cartId: cart.id }, transaction });

    await cart.update(
      {
        vendorId: null,
        couponId: null,
        couponCode: null,
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        deliveryFee: 0,
        grandTotal: 0,
        updatedBy: req.user.id,
      },
      { transaction }
    );
  });

  return getCart(req);
}

async function applyCoupon(body, req) {
  await sequelize.transaction(async (transaction) => {
    const { cart } = await getOrCreateCart(req, { transaction });

    const items = await loadItems(cart.id, { transaction });
    if (!items.length) throw AppError.businessRule('Add something to your cart before applying a coupon');

    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.variant.sellingPrice) * item.quantity,
      0
    );

    // Throws with a specific reason if the code does not apply.
    const { coupon } = await promotionService.validateForCart({
      code: body.couponCode,
      userId: req.user.id,
      subtotal,
      vendorId: cart.vendorId,
      transaction,
    });

    await cart.update(
      { couponId: coupon.id, couponCode: coupon.code, updatedBy: req.user.id },
      { transaction }
    );
  });

  return getCart(req);
}

async function removeCoupon(req) {
  await sequelize.transaction(async (transaction) => {
    const { cart } = await getOrCreateCart(req, { transaction });
    await cart.update({ couponId: null, couponCode: null, updatedBy: req.user.id }, { transaction });
  });

  return getCart(req);
}

/**
 * Pre-checkout readiness report.
 *
 * Runs the same gates checkout will run — availability, vendor licence,
 * compliance, minimum order value — but returns them as a list rather than
 * throwing, so the cart screen can show every blocker at once.
 */
async function validateForCheckout(body, req) {
  const { cart, profile } = await getOrCreateCart(req);
  const { items, totals } = await recalculate(cart, { req });

  const blockers = [];

  if (!items.length) {
    blockers.push({ code: 'EMPTY_CART', message: 'Your cart is empty.' });
    return { ready: false, blockers, cart: serializeCart(cart, { items, totals }) };
  }

  const vendor = await Vendor.findByPk(cart.vendorId);
  if (!vendor) {
    blockers.push({ code: 'NO_VENDOR', message: 'Your cart is not associated with a store.' });
  }

  collectWarnings(items, vendor).forEach((warning) => blockers.push(warning));

  const availability = await inventoryService.checkAvailability(
    items.map((i) => ({ productVariantId: i.productVariantId, quantity: i.quantity })),
    cart.vendorId
  );
  availability.shortfalls.forEach((shortfall) => {
    blockers.push({
      code: 'INSUFFICIENT_STOCK',
      message: `Only ${shortfall.available} unit(s) of ${shortfall.productName} are left.`,
      ...shortfall,
    });
  });

  if (vendor?.minOrderAmount && totals.subtotal < Number(vendor.minOrderAmount)) {
    blockers.push({
      code: 'BELOW_MINIMUM_ORDER',
      message: `${vendor.businessName} has a minimum order of ${vendor.minOrderAmount}.`,
      minOrderAmount: Number(vendor.minOrderAmount),
      subtotal: totals.subtotal,
    });
  }

  // Compliance is evaluated against the address the customer intends to use.
  const addressId = body.deliveryAddressId || profile.defaultAddressId;
  let complianceReport = null;

  if (!addressId) {
    blockers.push({ code: 'NO_DELIVERY_ADDRESS', message: 'Add a delivery address to continue.' });
  } else {
    const address = await CustomerAddress.findOne({
      where: { id: addressId, customerId: profile.id },
    });

    if (!address) {
      blockers.push({ code: 'INVALID_ADDRESS', message: 'That delivery address was not found.' });
    } else {
      complianceReport = await complianceService.evaluateOrder({
        address,
        dateOfBirth: profile.dateOfBirth,
        ageVerified: profile.ageVerified,
        totalQuantity: totals.totalQuantity,
        grandTotal: totals.grandTotal,
        productTypes: items.map((i) => i.variant?.product?.productType).filter(Boolean),
      });

      complianceReport.violations.forEach((violation) => blockers.push(violation));

      if (vendor) {
        try {
          await vendorService.assertOperational(vendor.id, complianceReport.regionCode);
        } catch (err) {
          blockers.push({
            code: err.errors?.[0]?.code || 'VENDOR_NOT_OPERATIONAL',
            message: err.message,
          });
        }
      }
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    compliance: complianceReport,
    cart: serializeCart(cart, { items, totals, vendor }),
  };
}

/**
 * Marks stale carts abandoned so they stop appearing as live.
 * Intended for a scheduled job.
 */
async function expireStaleCarts() {
  const cutoff = new Date(Date.now() - config.fulfilment.cartExpiryHours * 3600 * 1000);

  const [affected] = await Cart.update(
    { status: CART_STATUS.ABANDONED },
    { where: { status: CART_STATUS.ACTIVE, updatedAt: { [Op.lt]: cutoff } } }
  );

  return { abandoned: affected };
}

module.exports = {
  getOrCreateCart,
  loadItems,
  recalculate,
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  applyCoupon,
  removeCoupon,
  validateForCheckout,
  expireStaleCarts,
  serializeCart,
  serializeItem,
  collectWarnings,
};
