'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const {
  sequelize, Cart, CartItem, ProductVariant, Product, Vendor, Inventory, CustomerAddress,
} = require('../models');
const {
  CART_STATUS, PRODUCT_STATUS, VARIANT_STATUS, VENDOR_STATUS,
} = require('../config/constants');
const { ok, updated, fail } = require('../utils/response');
const cartService = require('../services/cart.service');
const promotionService = require('../services/promotion.service');
const inventoryService = require('../services/inventory.service');
const complianceService = require('../services/compliance.service');
const vendorAccessService = require('../services/vendorAccess.service');

/**
 * The shopping cart.
 *
 * A cart is single-vendor by design: Bottle Bee delivers from one licensed store
 * per order, so the first item pins `vendorId` and an item from another store is
 * refused until the cart is cleared. This is a licensing constraint, not a UX
 * preference — one order, one licensed seller.
 *
 * Totals are never accepted from the client. Every mutation ends by recomputing
 * them from the database through the shared pricing engine.
 *
 * Cart items are soft-deleted and `(cart_id, product_variant_id)` is unique, so
 * re-adding a removed item restores the existing row rather than colliding with
 * it.
 */

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

/** Loads, recomputes and serializes the caller's cart — the common tail. */
async function respondWithCart(req, res, message = 'Cart fetched successfully') {
  const { cart } = await cartService.getOrCreateCart(req);
  const { items, totals, coupon, couponError } = await cartService.recalculate(cart, { req });

  const vendor = cart.vendorId ? await Vendor.findByPk(cart.vendorId) : null;

  return ok(
    res,
    cartService.serializeCart(cart, {
      items,
      totals,
      coupon,
      couponError,
      vendor,
      warnings: cartService.collectWarnings(items, vendor),
    }),
    message
  );
}

/* -------------------------------------------------------------------------- */
/*                                GET MY CART                                 */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    return await respondWithCart(req, res);
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching cart', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            ADD AN ITEM TO CART                             */
/* -------------------------------------------------------------------------- */
const addItem = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const { cart } = await cartService.getOrCreateCart(req, { transaction });

      const variant = await ProductVariant.findByPk(req.body.productVariantId, {
        include: [{
          model: Product,
          as: 'product',
          include: [{ model: Vendor, as: 'vendor' }],
        }],
        transaction,
      });

      if (!variant) {
        const err = new Error('That product option does not exist');
        err.statusCode = 404;
        throw err;
      }

      const product = variant.product;
      if (!product) {
        const err = new Error('Parent product not found');
        err.statusCode = 404;
        throw err;
      }

      if (product.status !== PRODUCT_STATUS.ACTIVE || !product.isActive) {
        const err = new Error('This product is not available for purchase');
        err.statusCode = 409;
        throw err;
      }
      if (variant.status !== VARIANT_STATUS.ACTIVE || !variant.isActive) {
        const err = new Error('This product option is not available for purchase');
        err.statusCode = 409;
        throw err;
      }
      if (!product.vendor
        || product.vendor.status !== VENDOR_STATUS.APPROVED
        || !product.vendor.isActive) {
        const err = new Error('This store is not currently accepting orders');
        err.statusCode = 409;
        throw err;
      }

      // One order, one licensed store.
      if (cart.vendorId && Number(cart.vendorId) !== Number(product.vendorId)) {
        const current = await Vendor.findByPk(cart.vendorId, {
          attributes: ['businessName'],
          transaction,
        });

        const err = new Error(
          `Your cart already contains items from ${current?.businessName || 'another store'}. Bottle Bee delivers from one store per order — clear your cart to shop here instead.`
        );
        err.statusCode = 409;
        err.errors = [{
          code: 'MIXED_VENDOR_CART',
          currentVendorId: Number(cart.vendorId),
          attemptedVendorId: Number(product.vendorId),
        }];
        throw err;
      }

      // The unique key survives a soft delete, so a previously removed line is
      // restored rather than duplicated.
      const existing = await CartItem.findOne({
        where: { cartId: cart.id, productVariantId: variant.id },
        paranoid: false,
        transaction,
      });

      const requested = existing && !existing.deletedAt
        ? existing.quantity + req.body.quantity
        : req.body.quantity;

      const inventory = await Inventory.findOne({
        where: { vendorId: product.vendorId, productVariantId: variant.id },
        transaction,
      });
      const available = inventory?.quantityAvailable ?? 0;

      if (available < requested) {
        const err = new Error(
          available === 0
            ? `${product.name} is out of stock.`
            : `Only ${available} unit(s) of ${product.name} are available.`
        );
        err.statusCode = 409;
        err.errors = [{ code: 'INSUFFICIENT_STOCK', available, requested }];
        throw err;
      }

      const lineTotal = Number(variant.sellingPrice) * requested;

      if (existing) {
        if (existing.deletedAt) await existing.restore({ transaction });
        await existing.update(
          {
            quantity: requested,
            unitPrice: variant.sellingPrice,
            lineTotal,
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
            quantity: requested,
            unitPrice: variant.sellingPrice,
            lineTotal,
            createdBy: req.user.id,
          },
          { transaction }
        );
      }

      if (!cart.vendorId) {
        await cart.update({ vendorId: product.vendorId, updatedBy: req.user.id }, { transaction });
      }
    });

    return await respondWithCart(req, res, 'Item added to cart');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error adding item to cart', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          UPDATE AN ITEM QUANTITY                           */
/* -------------------------------------------------------------------------- */
const updateItem = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const { cart } = await cartService.getOrCreateCart(req, { transaction });

      const item = await CartItem.findOne({
        where: { id: req.body.id, cartId: cart.id },
        include: [{
          model: ProductVariant,
          as: 'variant',
          include: [{ model: Product, as: 'product' }],
        }],
        transaction,
      });

      if (!item) {
        const err = new Error('That item is not in your cart');
        err.statusCode = 404;
        throw err;
      }

      const inventory = await Inventory.findOne({
        where: {
          vendorId: item.variant.product.vendorId,
          productVariantId: item.productVariantId,
        },
        transaction,
      });
      const available = inventory?.quantityAvailable ?? 0;

      if (available < req.body.quantity) {
        const err = new Error(
          `Only ${available} unit(s) of ${item.variant.product.name} are available.`
        );
        err.statusCode = 409;
        err.errors = [{ code: 'INSUFFICIENT_STOCK', available, requested: req.body.quantity }];
        throw err;
      }

      await item.update(
        {
          quantity: req.body.quantity,
          unitPrice: item.variant.sellingPrice,
          lineTotal: Number(item.variant.sellingPrice) * req.body.quantity,
          updatedBy: req.user.id,
        },
        { transaction }
      );
    });

    return await respondWithCart(req, res, 'Cart updated');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error updating cart item', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             REMOVE AN ITEM                                 */
/* -------------------------------------------------------------------------- */
const removeItem = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const { cart } = await cartService.getOrCreateCart(req, { transaction });

      const item = await CartItem.findOne({
        where: { id: req.body.id, cartId: cart.id },
        transaction,
      });

      if (!item) {
        const err = new Error('That item is not in your cart');
        err.statusCode = 404;
        throw err;
      }

      await item.update({ deletedBy: req.user.id }, { transaction });
      await item.destroy({ transaction });

      // Releasing the vendor pin lets the customer shop elsewhere once the cart
      // is empty, without needing an explicit clear.
      const remaining = await CartItem.count({ where: { cartId: cart.id }, transaction });
      if (remaining === 0) {
        await cart.update(
          { vendorId: null, couponId: null, couponCode: null, updatedBy: req.user.id },
          { transaction }
        );
      }
    });

    return await respondWithCart(req, res, 'Item removed from cart');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error removing cart item', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                                CLEAR CART                                  */
/* -------------------------------------------------------------------------- */
const clear = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const { cart } = await cartService.getOrCreateCart(req, { transaction });

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

    return await respondWithCart(req, res, 'Cart cleared');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error clearing cart', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              APPLY A COUPON                                */
/* -------------------------------------------------------------------------- */
const applyCoupon = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const { cart } = await cartService.getOrCreateCart(req, { transaction });

      const items = await cartService.loadItems(cart.id, { transaction });
      if (!items.length) {
        const err = new Error('Add something to your cart before applying a coupon');
        err.statusCode = 409;
        throw err;
      }

      const subtotal = items.reduce(
        (sum, item) => sum + Number(item.variant.sellingPrice) * item.quantity,
        0
      );

      // Throws with a specific reason code if the coupon does not apply.
      const { coupon } = await promotionService.validateForCart({
        code: req.body.couponCode,
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

    return await respondWithCart(req, res, 'Coupon applied');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error applying coupon', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             REMOVE THE COUPON                              */
/* -------------------------------------------------------------------------- */
const removeCoupon = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const { cart } = await cartService.getOrCreateCart(req, { transaction });
      await cart.update(
        { couponId: null, couponCode: null, updatedBy: req.user.id },
        { transaction }
      );
    });

    return await respondWithCart(req, res, 'Coupon removed');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error removing coupon', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        PRE-CHECKOUT READINESS REPORT                       */
/* -------------------------------------------------------------------------- */
/**
 * Runs the same gates checkout will run — availability, vendor licence,
 * compliance, minimum order value — but returns them as a list instead of
 * throwing on the first, so the cart screen can show every blocker at once
 * rather than making the customer discover them one at a time.
 */
const validateForCheckout = async (req, res) => {
  try {
    const { cart, profile } = await cartService.getOrCreateCart(req);
    const { items, totals } = await cartService.recalculate(cart, { req });

    const blockers = [];

    if (!items.length) {
      return ok(
        res,
        {
          ready: false,
          blockers: [{ code: 'EMPTY_CART', message: 'Your cart is empty.' }],
          cart: cartService.serializeCart(cart, { items, totals }),
        },
        'Cart is not ready for checkout'
      );
    }

    const vendor = await Vendor.findByPk(cart.vendorId);
    if (!vendor) {
      blockers.push({
        code: 'NO_VENDOR',
        message: 'Your cart is not associated with a store.',
      });
    }

    cartService.collectWarnings(items, vendor).forEach((w) => blockers.push(w));

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
    const addressId = req.body.deliveryAddressId || profile.defaultAddressId;
    let complianceReport = null;

    if (!addressId) {
      blockers.push({
        code: 'NO_DELIVERY_ADDRESS',
        message: 'Add a delivery address to continue.',
      });
    } else {
      const address = await CustomerAddress.findOne({
        where: { id: addressId, customerId: profile.id },
      });

      if (!address) {
        blockers.push({
          code: 'INVALID_ADDRESS',
          message: 'That delivery address was not found.',
        });
      } else {
        complianceReport = await complianceService.evaluateOrder({
          address,
          dateOfBirth: profile.dateOfBirth,
          ageVerified: profile.ageVerified,
          totalQuantity: totals.totalQuantity,
          grandTotal: totals.grandTotal,
          productTypes: items.map((i) => i.variant?.product?.productType).filter(Boolean),
        });

        complianceReport.violations.forEach((v) => blockers.push(v));

        if (vendor) {
          try {
            await vendorAccessService.assertOperational(vendor.id, complianceReport.regionCode);
          } catch (err) {
            blockers.push({
              code: err.errors?.[0]?.code || 'VENDOR_NOT_OPERATIONAL',
              message: err.message,
            });
          }
        }
      }
    }

    return ok(
      res,
      {
        ready: blockers.length === 0,
        blockers,
        compliance: complianceReport,
        cart: cartService.serializeCart(cart, { items, totals, vendor }),
      },
      blockers.length === 0 ? 'Cart is ready for checkout' : 'Cart is not ready for checkout'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error validating cart', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          ABANDON STALE CARTS                               */
/* -------------------------------------------------------------------------- */
/** Intended for a scheduled job. Marks untouched carts abandoned. */
const expireStale = async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - config.fulfilment.cartExpiryHours * 3600 * 1000);

    const [abandoned] = await Cart.update(
      { status: CART_STATUS.ABANDONED, updatedBy: req.user.id },
      { where: { status: CART_STATUS.ACTIVE, updatedAt: { [Op.lt]: cutoff } } }
    );

    return updated(res, { abandoned }, 'Stale carts abandoned');
  } catch (error) {
    return fail(res, 'Error expiring stale carts', 500, [{ message: error.message }]);
  }
};

module.exports = {
  detail,
  addItem,
  updateItem,
  removeItem,
  clear,
  applyCoupon,
  removeCoupon,
  validateForCheckout,
  expireStale,
};
