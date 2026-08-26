'use strict';

const express = require('express');

const router = express.Router();

/**
 * Version 1 router.
 *
 * Health comes first so load-balancer probes match on the cheapest route.
 * Everything else is grouped by domain, roughly in the order a request travels
 * through the platform: identity, then the people, then the catalog, then the
 * purchase.
 */

// --- Platform ---------------------------------------------------------------
router.use('/health', require('./health.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/rbac', require('./rbac.routes'));

// --- People and compliance --------------------------------------------------
router.use('/customers', require('./customer.routes'));
router.use('/age-verifications', require('./ageVerification.routes'));
router.use('/compliance', require('./compliance.routes'));
router.use('/vendors', require('./vendor.routes'));

// --- Catalog ----------------------------------------------------------------
router.use('/categories', require('./category.routes'));
router.use('/brands', require('./brand.routes'));
router.use('/products', require('./product.routes'));
router.use('/catalog', require('./publicCatalog.routes'));
router.use('/inventory', require('./inventory.routes'));

// --- Purchase ---------------------------------------------------------------
router.use('/cart', require('./cart.routes'));
router.use('/orders', require('./order.routes'));
router.use('/coupons', require('./coupon.routes'));
router.use('/promotions', require('./promotion.routes'));
router.use('/payments', require('./payment.routes'));
router.use('/delivery', require('./delivery.routes'));

// --- After the sale ---------------------------------------------------------
router.use('/reviews', require('./review.routes'));
router.use('/notifications', require('./notification.routes'));

// --- Platform administration ------------------------------------------------
router.use('/admin', require('./admin.routes'));


module.exports = router;
