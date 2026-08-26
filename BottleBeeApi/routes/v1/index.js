'use strict';

const express = require('express');

const router = express.Router();

/**
 * Version 1 router. Every module mounts here; the order is alphabetical apart
 * from health, which stays first so probes are matched cheaply.
 */
router.use('/health', require('./health.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/rbac', require('./rbac.routes'));

module.exports = router;
