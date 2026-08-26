'use strict';

const config = require('../config');
const {
  Cart, CartItem, ProductVariant, Product, Vendor, Inventory,
} = require('../models');
const {
  CART_STATUS, PRODUCT_STATUS, VARIANT_STATUS, VENDOR_STATUS,
} = require('../config/constants');
const customerService = require('./customer.service');
const pricingService = require('./pricing.service');
const promotionService = require('./promotion.service');

/**
 * Shared cart primitives — SHARED SERVICE.
 *
 * Cart operations (add, update, remove, clear, apply coupon) live in
 * `cart.controller.js`. What stays here is what the order controller also needs
 * at checkout: loading the cart, loading its items joined to the catalog,
 * recomputing its totals, and deciding whether a line is still purchasable.
 *
 * Checkout must see exactly what the cart screen saw, so these cannot be
 * duplicated: if the two disagreed about a price or about whether an item is
 * available, a customer could be charged for something the cart said was fine.
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
function loadItems(cartId, { transaction = null } = {}) {
  return CartItem.findAll({
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
          include: [{
            model: Vendor,
            as: 'vendor',
            attributes: ['id', 'businessName', 'status', 'minOrderAmount'],
          }],
        },
        { model: Inventory, as: 'inventory', required: false },
      ],
    }],
    order: [['createdAt', 'ASC']],
    transaction,
  });
}

/**
 * Recomputes and persists the five cart totals.
 *
 * Prices always come from the catalog, never from the stored cart row, so a
 * price change is reflected before the customer pays rather than after.
 */
async function recalculate(cart, { transaction = null, req = null } = {}) {
  const items = await loadItems(cart.id, { transaction });

  let coupon = null;
  let couponError = null;

  if (cart.couponId) {
    // Re-validate on every recalculation: a coupon can expire, or the cart can
    // fall below its minimum, between being applied and being used.
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
      // Drop the coupon rather than blocking the cart, and say why.
      couponError = err.message;
      coupon = null;
    }
  }

  const totals = pricingService.computeTotals(
    items.map((item) => ({
      cartItemId: item.id,
      productVariantId: item.productVariantId,
      quantity: item.quantity,
      unitPrice: Number(item.variant.sellingPrice),
      taxPercent: Number(item.variant.taxPercent || 0),
    })),
    { coupon }
  );

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

/**
 * Whether a line can still be bought: live product, live variant, approved
 * store. Checkout and the cart screen must agree on this exactly.
 */
function isPurchasable(item) {
  const product = item.variant?.product;
  return !!(
    product?.status === PRODUCT_STATUS.ACTIVE
    && item.variant?.status === VARIANT_STATUS.ACTIVE
    && product?.vendor?.status === VENDOR_STATUS.APPROVED
  );
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
    isPurchasable: isPurchasable(item),
  };
}

function serializeCart(cart, {
  items = [], totals = null, coupon = null, couponError = null, vendor = null, warnings = [],
} = {}) {
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

/** Everything that would block checkout, so the cart screen can explain it. */
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

module.exports = {
  getOrCreateCart,
  loadItems,
  recalculate,
  isPurchasable,
  serializeItem,
  serializeCart,
  collectWarnings,
};
