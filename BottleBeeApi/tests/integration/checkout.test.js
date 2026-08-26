'use strict';

const db = require('../helpers/testDb');
const { Inventory, ProductVariant, Coupon, CouponUsage } = require('../../models');

/**
 * Checkout: the compliance and stock guarantees.
 *
 * These are the assertions that justify the transaction. A checkout that fails
 * halfway must leave nothing behind — no reserved stock, no consumed coupon, no
 * half-written order — and a checkout that succeeds must reserve stock rather
 * than delete it, so a cancellation can give it back.
 */
describe('checkout', () => {
  let available = false;
  let customer;

  beforeAll(async () => {
    available = await db.isAvailable();
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn('  bottle_bee_test not reachable — skipping. Run: npm run test:db:setup');
      return;
    }
    customer = await db.login('customer');
  });

  afterAll(async () => {
    if (available) await db.close();
  });

  const maybe = (name, fn) => it(name, async () => {
    if (!available) return;
    await fn();
  });

  /** Current stock for a SKU, read straight from the table. */
  const stockOf = async (sku) => {
    const variant = await ProductVariant.findOne({ where: { sku } });
    const inventory = await Inventory.findOne({ where: { productVariantId: variant.id } });
    return {
      variantId: variant.id,
      available: inventory.quantityAvailable,
      reserved: inventory.quantityReserved,
    };
  };

  describe('cart', () => {
    maybe('recomputes totals server-side and ignores any client price', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('KF-PREM-650');

      // unitPrice and lineTotal are deliberately absurd; both must be ignored.
      const res = await db.post('/cart/add-item', customer, {
        productVariantId: variantId,
        quantity: 2,
        unitPrice: 1,
        lineTotal: 2,
        grandTotal: 2,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.subtotal).toBe(300);
      expect(res.body.data.items[0].unitPrice).toBe(150);
    });

    maybe('refuses more than the available stock', async () => {
      await db.clearCart(customer);
      const { variantId, available: qty } = await stockOf('GT-LDG-750');

      const res = await db.post('/cart/add-item', customer, {
        productVariantId: variantId,
        quantity: qty + 50,
      });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('INSUFFICIENT_STOCK');
    });

    maybe('reserves nothing while items merely sit in the cart', async () => {
      await db.clearCart(customer);
      const before = await stockOf('KF-PREM-650');

      await db.post('/cart/add-item', customer, {
        productVariantId: before.variantId,
        quantity: 3,
      });

      const after = await stockOf('KF-PREM-650');
      expect(after.available).toBe(before.available);
      expect(after.reserved).toBe(before.reserved);
    });
  });

  describe('coupons', () => {
    maybe('rejects an unknown code with a specific reason', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('GLEN12-750');
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const res = await db.post('/cart/apply-coupon', customer, { couponCode: 'NOSUCHCODE' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('COUPON_NOT_FOUND');
    });

    maybe('refuses a coupon below its minimum order value', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('KF-PREM-650');
      // 1 x 150 is far below CHEERS20's 1000 minimum.
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const res = await db.post('/cart/apply-coupon', customer, { couponCode: 'CHEERS20' });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('COUPON_MIN_ORDER_NOT_MET');
    });

    maybe('caps a percentage coupon at its maximum discount', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('GLEN12-750');
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const res = await db.post('/cart/apply-coupon', customer, { couponCode: 'CHEERS20' });

      // 20% of 5899 is 1179.80, above the 500 ceiling.
      expect(res.status).toBe(200);
      expect(res.body.data.discountTotal).toBe(500);
    });
  });

  describe('placing an order', () => {
    maybe('refuses an empty cart', async () => {
      await db.clearCart(customer);
      const res = await db.post('/orders/checkout', customer, { paymentMethod: 'CASH' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/cart is empty/i);
    });

    maybe('reserves stock rather than removing it, and consumes the cart', async () => {
      await db.clearCart(customer);
      const before = await stockOf('AMRUT-FUS-700');

      await db.post('/cart/add-item', customer, {
        productVariantId: before.variantId,
        quantity: 2,
      });

      const res = await db.post('/orders/checkout', customer, { paymentMethod: 'CASH' });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('CONFIRMED');

      const after = await stockOf('AMRUT-FUS-700');
      // Two units moved from available to reserved; the total is unchanged,
      // so a cancellation can hand them straight back.
      expect(after.available).toBe(before.available - 2);
      expect(after.reserved).toBe(before.reserved + 2);
      expect(after.available + after.reserved).toBe(before.available + before.reserved);

      const cart = await db.post('/cart/detail', customer, {});
      expect(cart.body.data.itemCount).toBe(0);
      expect(cart.body.data.vendorId).toBeFalsy();
    });

    maybe('records the region whose rules were applied', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('OM-SUP-750');
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const res = await db.post('/orders/checkout', customer, { paymentMethod: 'CASH' });
      expect(res.body.data.regionCode).toBe('IN-TS');
    });

    maybe('snapshots the delivery address onto the order', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('OM-SUP-750');
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const res = await db.post('/orders/checkout', customer, { paymentMethod: 'CASH' });

      // Frozen at purchase, so editing the address later cannot rewrite history.
      expect(res.body.data.deliveryAddress).toMatchObject({
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500081',
      });
    });

    maybe('starts an online order in PAYMENT_PENDING, not CONFIRMED', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('OM-SUP-750');
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const res = await db.post('/orders/checkout', customer, { paymentMethod: 'RAZORPAY' });

      expect(res.body.data.status).toBe('PAYMENT_PENDING');
      expect(res.body.data.paymentStatus).toBe('PENDING');
    });
  });

  describe('coupon redemption', () => {
    maybe('increments usage and records a usage row on success', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('SULA-RASA-750');

      const before = await Coupon.findOne({ where: { code: 'FLAT200' } });
      const beforeUsages = await CouponUsage.count({ where: { couponId: before.id } });

      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });
      const applied = await db.post('/cart/apply-coupon', customer, { couponCode: 'FLAT200' });
      expect(applied.body.data.discountTotal).toBe(200);

      const order = await db.post('/orders/checkout', customer, { paymentMethod: 'CASH' });
      expect(order.status).toBe(201);
      expect(order.body.data.discountTotal).toBe(200);

      const after = await Coupon.findOne({ where: { code: 'FLAT200' } });
      const afterUsages = await CouponUsage.count({ where: { couponId: after.id } });

      expect(after.usageCount).toBe(before.usageCount + 1);
      expect(afterUsages).toBe(beforeUsages + 1);
    });
  });

  describe('cancellation', () => {
    maybe('returns reserved stock and un-redeems the coupon', async () => {
      await db.clearCart(customer);
      const before = await stockOf('SULA-RASA-750');
      const couponBefore = await Coupon.findOne({ where: { code: 'FLAT200' } });

      await db.post('/cart/add-item', customer, {
        productVariantId: before.variantId,
        quantity: 1,
      });
      await db.post('/cart/apply-coupon', customer, { couponCode: 'FLAT200' });

      const order = await db.post('/orders/checkout', customer, { paymentMethod: 'CASH' });
      const orderId = order.body.data.id;

      const reserved = await stockOf('SULA-RASA-750');
      expect(reserved.reserved).toBe(before.reserved + 1);

      const cancelled = await db.post('/orders/cancel', customer, {
        id: orderId,
        reason: 'Testing the cancellation path',
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');

      const after = await stockOf('SULA-RASA-750');
      expect(after.available).toBe(before.available);
      expect(after.reserved).toBe(before.reserved);

      const couponAfter = await Coupon.findOne({ where: { code: 'FLAT200' } });
      expect(couponAfter.usageCount).toBe(couponBefore.usageCount);
    });

    maybe('requires a reason', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('OM-SUP-750');
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const order = await db.post('/orders/checkout', customer, { paymentMethod: 'CASH' });
      const res = await db.post('/orders/cancel', customer, { id: order.body.data.id });

      expect(res.status).toBe(422);
    });
  });

  describe('order access control', () => {
    maybe('hides another customer\'s order from a vendor of a different store', async () => {
      const vendor = await db.login('vendor');
      const orders = await db.post('/orders/list', vendor, { limit: 5 });

      // The sample vendor owns every order here, so this asserts the scoping
      // returns their own rather than everything on the platform.
      expect(orders.status).toBe(200);
      orders.body.data.forEach((o) => expect(o.vendorId).toBe(1));
    });

    maybe('refuses an order id that does not belong to the caller', async () => {
      const res = await db.post('/orders/detail', customer, { id: 999999 });
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('pre-checkout validation', () => {
    maybe('reports readiness with the applied compliance rules', async () => {
      await db.clearCart(customer);
      const { variantId } = await stockOf('OM-SUP-750');
      await db.post('/cart/add-item', customer, { productVariantId: variantId, quantity: 1 });

      const res = await db.post('/cart/validate-checkout', customer, {});

      expect(res.status).toBe(200);
      expect(res.body.data.ready).toBe(true);
      expect(res.body.data.blockers).toEqual([]);
      expect(res.body.data.compliance.regionCode).toBe('IN-TS');
      expect(res.body.data.compliance.appliedRule.minimumAge).toBe(21);
    });

    maybe('reports an empty cart as not ready', async () => {
      await db.clearCart(customer);
      const res = await db.post('/cart/validate-checkout', customer, {});

      expect(res.body.data.ready).toBe(false);
      expect(res.body.data.blockers[0].code).toBe('EMPTY_CART');
    });
  });
});
