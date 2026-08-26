'use strict';

const express = require('express');

const controller = require('../../controllers/product.controller');
const validate = require('../../middlewares/validate');
const { optionalAuthenticate } = require('../../middlewares/authenticate');
const schemas = require('../../validators/product.validator');

const router = express.Router();

/**
 * The public storefront. Every endpoint here is unauthenticated but still
 * filtered: only ACTIVE products, from APPROVED and active stores, with a
 * purchasable variant, are ever returned. Passing `regionCode` narrows results
 * further to stores licensed for that region, so a customer never browses
 * something checkout would refuse.
 */
router.use(optionalAuthenticate);

/**
 * @openapi
 * /api/v1/catalog/products/list:
 *   post:
 *     tags: [Public Catalog]
 *     summary: Browse, search and filter products
 *     description: |
 *       Public. Full-text search on name and description, plus filters for
 *       category, brand, store, product type, price band, bottle size, alcohol
 *       strength, rating and stock.
 *
 *       Sort with `sortBy` = `name`, `price`, `ratingAvg`, `ratingCount` or
 *       `createdAt`. `price` sorts on the variant selling price.
 *
 *       Only ACTIVE products from APPROVED stores appear. Supply `regionCode` to
 *       restrict results to stores licensed to deliver there.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   categoryId: { type: integer }
 *                   brandId:
 *                     oneOf:
 *                       - type: integer
 *                       - type: array
 *                         items: { type: integer }
 *                   vendorId: { type: integer }
 *                   productType: { $ref: '#/components/schemas/ProductType' }
 *                   minPrice: { type: number, example: 500 }
 *                   maxPrice: { type: number, example: 5000 }
 *                   sizeMl:
 *                     oneOf:
 *                       - type: integer
 *                       - type: array
 *                         items: { type: integer }
 *                   minAlcohol: { type: number, example: 4 }
 *                   maxAlcohol: { type: number, example: 45 }
 *                   minRating: { type: number, example: 4 }
 *                   isFeatured: { type: boolean }
 *                   inStockOnly: { type: boolean, default: false }
 *                   regionCode: { type: string, example: IN-TS }
 *                   sortBy:
 *                     type: string
 *                     enum: [name, price, ratingAvg, ratingCount, createdAt]
 *     responses:
 *       200:
 *         description: Products
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/products/list', validate(schemas.publicListSchema), controller.publicList);

/**
 * @openapi
 * /api/v1/catalog/products/detail:
 *   post:
 *     tags: [Public Catalog]
 *     summary: Product detail with variants, stock and reviews
 *     description: |
 *       Public. Look up by `id`, or by `slug` together with `vendorId` (slugs are
 *       unique per store, not globally). Includes the ten most recent approved
 *       reviews; only the reviewer's first name is exposed.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id: { type: integer }
 *               slug: { type: string, example: glenfiddich-12-year-old }
 *               vendorId: { type: integer }
 *               regionCode: { type: string, example: IN-TS }
 *     responses:
 *       200:
 *         description: Product
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/products/detail', validate(schemas.publicDetailSchema), controller.publicDetail);

/**
 * @openapi
 * /api/v1/catalog/filters:
 *   post:
 *     tags: [Public Catalog]
 *     summary: Available filter facets
 *     description: |
 *       Public. Categories, brands, product types with counts, the live price
 *       range and the bottle sizes actually on sale — everything the storefront
 *       sidebar needs in one call.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Facets
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/filters', validate(schemas.emptySchema), controller.publicFilters);

/**
 * @openapi
 * /api/v1/catalog/stores/detail:
 *   post:
 *     tags: [Public Catalog]
 *     summary: Public store profile
 *     description: Public. Name, description, rating, minimum order value and live product count. Only APPROVED stores are returned.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Store
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/stores/detail', validate(schemas.idSchema), controller.publicVendorDetail);

module.exports = router;
