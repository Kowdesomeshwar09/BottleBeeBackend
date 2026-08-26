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
 * /api/v1/categories/list:
 *   post:
 *     tags: [Public Catalog]
 *     summary: List categories
 *     description: Public. Reference data used by both the storefront and the vendor product form.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   parentId: { type: integer, nullable: true }
 *                   topLevelOnly: { type: boolean }
 *                   isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Categories
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 */
router.post('/list', optionalAuthenticate, validate(schemas.listCategoriesSchema), controller.listCategories);

/**
 * @openapi
 * /api/v1/categories/tree:
 *   post:
 *     tags: [Public Catalog]
 *     summary: Category tree for navigation
 *     description: Public. Active categories with their sub-categories nested, ordered for display.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Tree
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/tree', optionalAuthenticate, validate(schemas.emptySchema), controller.categoryTree);

/**
 * @openapi
 * /api/v1/categories/detail:
 *   post:
 *     tags: [Public Catalog]
 *     summary: Get one category
 *     description: Public. Includes sub-categories and the number of products in it.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Category
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/detail', optionalAuthenticate, validate(schemas.idSchema), controller.getCategory);

router.use(authenticate);

/**
 * @openapi
 * /api/v1/categories/create:
 *   post:
 *     tags: [Catalog]
 *     summary: Create a category
 *     description: |
 *       Requires permission: `CATEGORY_MANAGE`. Categories support two levels of
 *       nesting; the slug is generated from the name and made unique automatically.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               parentId: { type: integer, nullable: true }
 *               name: { type: string, example: Single Malt }
 *               slug: { type: string }
 *               description: { type: string }
 *               imageUrl: { type: string }
 *               sortOrder: { type: integer }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/create',
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(schemas.createCategorySchema),
  controller.createCategory
);

/**
 * @openapi
 * /api/v1/categories/update:
 *   post:
 *     tags: [Catalog]
 *     summary: Update a category
 *     description: 'Requires permission: `CATEGORY_MANAGE`. A category with sub-categories cannot itself be nested.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               parentId: { type: integer, nullable: true }
 *               name: { type: string }
 *               description: { type: string }
 *               imageUrl: { type: string }
 *               sortOrder: { type: integer }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/update',
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(schemas.updateCategorySchema),
  controller.updateCategory
);

/**
 * @openapi
 * /api/v1/categories/delete:
 *   post:
 *     tags: [Catalog]
 *     summary: Delete a category
 *     description: |
 *       Requires permission: `CATEGORY_MANAGE`. Refused with 409 while products
 *       or sub-categories still reference it, so the catalog can never point at a
 *       missing category.
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
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(schemas.idSchema),
  controller.deleteCategory
);

module.exports = router;
