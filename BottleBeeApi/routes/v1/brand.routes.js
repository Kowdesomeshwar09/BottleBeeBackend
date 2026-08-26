'use strict';

const express = require('express');

const controller = require('../../controllers/catalog.controller');
const validate = require('../../middlewares/validate');
const { authenticate, optionalAuthenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/catalog.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/brands/list:
 *   post:
 *     tags: [Public Catalog]
 *     summary: List brands
 *     description: Public. Reference data for storefront filters and the vendor product form.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   countryOfOrigin: { type: string, example: Scotland }
 *                   isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Brands
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 */
router.post('/list', optionalAuthenticate, validate(schemas.listBrandsSchema), controller.listBrands);

/**
 * @openapi
 * /api/v1/brands/detail:
 *   post:
 *     tags: [Public Catalog]
 *     summary: Get one brand
 *     description: Public. Includes the number of products carrying the brand.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Brand
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/detail', optionalAuthenticate, validate(schemas.idSchema), controller.getBrand);

router.use(authenticate);

/**
 * @openapi
 * /api/v1/brands/create:
 *   post:
 *     tags: [Catalog]
 *     summary: Create a brand
 *     description: 'Requires permission: `BRAND_MANAGE`. The slug is generated from the name and made unique automatically.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Glenfiddich }
 *               slug: { type: string }
 *               description: { type: string }
 *               logoUrl: { type: string }
 *               countryOfOrigin: { type: string, example: Scotland }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/create',
  authorize(PERMISSIONS.BRAND_MANAGE),
  validate(schemas.createBrandSchema),
  controller.createBrand
);

/**
 * @openapi
 * /api/v1/brands/update:
 *   post:
 *     tags: [Catalog]
 *     summary: Update a brand
 *     description: 'Requires permission: `BRAND_MANAGE`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               name: { type: string }
 *               description: { type: string }
 *               logoUrl: { type: string }
 *               countryOfOrigin: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/update',
  authorize(PERMISSIONS.BRAND_MANAGE),
  validate(schemas.updateBrandSchema),
  controller.updateBrand
);

/**
 * @openapi
 * /api/v1/brands/delete:
 *   post:
 *     tags: [Catalog]
 *     summary: Delete a brand
 *     description: 'Requires permission: `BRAND_MANAGE`. Refused with 409 while products still reference it.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/delete',
  authorize(PERMISSIONS.BRAND_MANAGE),
  validate(schemas.idSchema),
  controller.deleteBrand
);

module.exports = router;
