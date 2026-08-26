'use strict';

const express = require('express');

const controller = require('../../controllers/health.controller');

const router = express.Router();

/**
 * @openapi
 * /api/v1/health/check:
 *   post:
 *     tags: [Health]
 *     summary: Liveness probe
 *     description: Reports that the process is running. Does not touch the database.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/check', controller.check);

/**
 * @openapi
 * /api/v1/health/ready:
 *   post:
 *     tags: [Health]
 *     summary: Readiness probe
 *     description: Verifies the database connection. Returns 503 when a dependency is down.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Service is ready
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       503:
 *         description: A dependency is unavailable
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/ready', controller.ready);

// GET aliases so container orchestrators and uptime monitors, which cannot send
// a POST, can still probe the service. The POST forms remain canonical.
router.get('/check', controller.check);
router.get('/ready', controller.ready);

module.exports = router;
