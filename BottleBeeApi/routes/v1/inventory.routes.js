'use strict';

const express = require('express');

const controller = require('../../controllers/inventory.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/inventory.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @openapi
 * /api/v1/inventory/list:
 *   post:
 *     tags: [Inventory]
 *     summary: List stock levels
 *     description: |
 *       Requires permission: `INVENTORY_VIEW`. Staff see every store; a vendor
 *       user sees only their own. Each row reports sellable stock
 *       (`quantityAvailable`) and stock held for open orders (`quantityReserved`).
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   vendorId: { type: integer }
 *                   productId: { type: integer }
 *                   lowStockOnly: { type: boolean }
 *                   outOfStockOnly: { type: boolean }
 *     responses:
 *       200:
 *         description: Inventory
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/list',
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate(schemas.listInventorySchema),
  controller.list
);

/**
 * @openapi
 * /api/v1/inventory/detail:
 *   post:
 *     tags: [Inventory]
 *     summary: Get one inventory record
 *     description: 'Requires permission: `INVENTORY_VIEW`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Inventory record
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/detail',
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate(schemas.idSchema),
  controller.detail
);

/**
 * @openapi
 * /api/v1/inventory/adjust:
 *   post:
 *     tags: [Inventory]
 *     summary: Adjust stock for one SKU
 *     description: |
 *       Requires permission: `INVENTORY_MANAGE` and an OWNER or MANAGER membership.
 *
 *       - `STOCK_IN` adds `quantity` units.
 *       - `STOCK_OUT` removes `quantity` units (breakage, transfer). Refused if
 *         it would exceed what is available, since reserved units belong to open orders.
 *       - `ADJUSTMENT` sets the absolute shelf count after a stock take.
 *
 *       Reserved stock is never modified here — that is driven by the order
 *       lifecycle. Every movement writes a ledger row and an audit entry, and
 *       crossing the reorder level notifies the store owner.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, transactionType, quantity]
 *             properties:
 *               id: { type: integer, description: Inventory record id. }
 *               transactionType: { type: string, enum: [STOCK_IN, STOCK_OUT, ADJUSTMENT] }
 *               quantity: { type: integer, example: 24 }
 *               reorderLevel: { type: integer, example: 6 }
 *               notes: { type: string, example: Delivery from distributor }
 *     responses:
 *       200:
 *         description: Stock adjusted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/adjust',
  authorize(PERMISSIONS.INVENTORY_MANAGE),
  validate(schemas.adjustSchema),
  controller.adjust
);

/**
 * @openapi
 * /api/v1/inventory/bulk-adjust:
 *   post:
 *     tags: [Inventory]
 *     summary: Adjust stock for many SKUs at once
 *     description: |
 *       Requires permission: `INVENTORY_MANAGE`. Intended for booking in a
 *       delivery. Each line is applied independently: a line that fails is
 *       reported in `failures` rather than discarding the whole batch.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionType, items]
 *             properties:
 *               transactionType: { type: string, enum: [STOCK_IN, STOCK_OUT, ADJUSTMENT] }
 *               notes: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [id, quantity]
 *                   properties:
 *                     id: { type: integer }
 *                     quantity: { type: integer }
 *                     reorderLevel: { type: integer }
 *     responses:
 *       200:
 *         description: Batch applied
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/bulk-adjust',
  authorize(PERMISSIONS.INVENTORY_MANAGE),
  validate(schemas.bulkAdjustSchema),
  controller.bulkAdjust
);

/**
 * @openapi
 * /api/v1/inventory/transactions:
 *   post:
 *     tags: [Inventory]
 *     summary: Movement ledger for one SKU
 *     description: |
 *       Requires permission: `INVENTORY_VIEW`. Every reservation, release, sale,
 *       return and manual adjustment, each carrying the balances immediately
 *       after it was applied.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 required: [id]
 *                 properties:
 *                   id: { type: integer, description: Inventory record id. }
 *                   transactionType: { $ref: '#/components/schemas/InventoryTransactionType' }
 *                   referenceType: { type: string, enum: [ORDER, MANUAL, REFUND, SYSTEM] }
 *     responses:
 *       200:
 *         description: Movements
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/transactions',
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate(schemas.transactionsSchema),
  controller.transactions
);

/**
 * @openapi
 * /api/v1/inventory/low-stock:
 *   post:
 *     tags: [Inventory]
 *     summary: Items at or below their reorder level
 *     description: 'Requires permission: `INVENTORY_VIEW`. Ordered by the lowest stock first.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Low stock items
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/low-stock',
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate(schemas.vendorScopeSchema),
  controller.lowStock
);

/**
 * @openapi
 * /api/v1/inventory/summary:
 *   post:
 *     tags: [Inventory]
 *     summary: Headline stock figures
 *     description: 'Requires permission: `INVENTORY_VIEW`. SKU count, out-of-stock and low-stock counts, and total units available and reserved.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Summary
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/summary',
  authorize(PERMISSIONS.INVENTORY_VIEW),
  validate(schemas.vendorScopeSchema),
  controller.summary
);

module.exports = router;
