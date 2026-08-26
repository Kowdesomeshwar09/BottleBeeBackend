'use strict';

const express = require('express');

const controller = require('../../controllers/product.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { imageUpload } = require('../../middlewares/upload');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/product.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @openapi
 * /api/v1/products/create:
 *   post:
 *     tags: [Catalog]
 *     summary: Create a product (vendor)
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE` and an OWNER or MANAGER membership.
 *       The product starts as DRAFT and is not publicly visible. Variants may be
 *       supplied inline; each one gets an inventory row automatically, optionally
 *       seeded with `initialStock`.
 *
 *       Publishing is a two-step flow: submit for approval, then an admin with
 *       `PRODUCT_APPROVE` makes it ACTIVE.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [categoryId, name, productType]
 *             properties:
 *               vendorId: { type: integer, description: Required only if you belong to several stores. }
 *               categoryId: { type: integer }
 *               brandId: { type: integer, nullable: true }
 *               name: { type: string, example: Glenfiddich 12 Year Old }
 *               description: { type: string }
 *               alcoholPercentage: { type: number, example: 40 }
 *               originCountry: { type: string, example: Scotland }
 *               productType: { $ref: '#/components/schemas/ProductType' }
 *               variants:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [sku, sizeMl, mrp, sellingPrice]
 *                   properties:
 *                     sku: { type: string, example: GLEN12-750 }
 *                     sizeMl: { type: integer, example: 750 }
 *                     packSize: { type: integer, default: 1 }
 *                     mrp: { type: number, example: 6200 }
 *                     sellingPrice: { type: number, example: 5899 }
 *                     taxPercent: { type: number, example: 18 }
 *                     initialStock: { type: integer, example: 24 }
 *                     reorderLevel: { type: integer, example: 6 }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/create',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.createProductSchema),
  controller.create
);

/**
 * @openapi
 * /api/v1/products/update:
 *   post:
 *     tags: [Catalog]
 *     summary: Update a product (vendor)
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE`.
 *       Editing the name, description or type of a live product returns it to
 *       PENDING_APPROVAL, so an approved listing cannot be quietly replaced.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               categoryId: { type: integer }
 *               brandId: { type: integer, nullable: true }
 *               name: { type: string }
 *               description: { type: string }
 *               alcoholPercentage: { type: number }
 *               productType: { $ref: '#/components/schemas/ProductType' }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/update',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.updateProductSchema),
  controller.update
);

/**
 * @openapi
 * /api/v1/products/submit-for-approval:
 *   post:
 *     tags: [Catalog]
 *     summary: Submit a draft for admin review
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE`. The product must have at least one
 *       variant with a size and price.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Submitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/submit-for-approval',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.idSchema),
  controller.submitForApproval
);

/**
 * @openapi
 * /api/v1/products/review:
 *   post:
 *     tags: [Catalog]
 *     summary: Approve or reject a product
 *     description: |
 *       Requires permission: `PRODUCT_APPROVE`. Approving publishes the listing.
 *       A product cannot be approved while its store is unapproved. Rejection
 *       requires a reason, which is sent to the vendor.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { type: string, enum: [ACTIVE, REJECTED] }
 *               rejectionReason: { type: string }
 *               isFeatured: { type: boolean }
 *     responses:
 *       200:
 *         description: Reviewed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/review',
  authorize(PERMISSIONS.PRODUCT_APPROVE),
  validate(schemas.reviewProductSchema),
  controller.review
);

/**
 * @openapi
 * /api/v1/products/list:
 *   post:
 *     tags: [Catalog]
 *     summary: List products including drafts (vendor or staff)
 *     description: |
 *       Requires permission: `PRODUCT_VIEW`. Staff see every product; a vendor
 *       user sees only products belonging to their own stores. Use
 *       `/catalog/products/list` for the public storefront instead.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   vendorId: { type: integer }
 *                   categoryId: { type: integer }
 *                   brandId: { type: integer }
 *                   status: { $ref: '#/components/schemas/ProductStatus' }
 *                   productType: { $ref: '#/components/schemas/ProductType' }
 *                   isFeatured: { type: boolean }
 *     responses:
 *       200:
 *         description: Products
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 */
router.post(
  '/list',
  authorize(PERMISSIONS.PRODUCT_VIEW),
  validate(schemas.listProductsSchema),
  controller.list
);

/**
 * @openapi
 * /api/v1/products/detail:
 *   post:
 *     tags: [Catalog]
 *     summary: Get one product with variants, images and stock
 *     description: |
 *       Requires permission: `PRODUCT_VIEW`. A product that is not ACTIVE may
 *       only be read by its own vendor or by staff.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Product
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/detail',
  authorize(PERMISSIONS.PRODUCT_VIEW),
  validate(schemas.idSchema),
  controller.detail
);

/**
 * @openapi
 * /api/v1/products/delete:
 *   post:
 *     tags: [Catalog]
 *     summary: Delete a product
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE`. Soft delete: the product and all
 *       its variants go inactive so nothing remains purchasable, while order
 *       history keeps pointing at them.
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
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/delete',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.idSchema),
  controller.remove
);

/**
 * @openapi
 * /api/v1/products/variants/create:
 *   post:
 *     tags: [Catalog]
 *     summary: Add a variant
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE`. SKUs are unique platform-wide.
 *       MRP may not be lower than the selling price. An inventory row is created
 *       for the variant automatically.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, sku, sizeMl, mrp, sellingPrice]
 *             properties:
 *               productId: { type: integer }
 *               sku: { type: string }
 *               sizeMl: { type: integer }
 *               packSize: { type: integer, default: 1 }
 *               mrp: { type: number }
 *               sellingPrice: { type: number }
 *               taxPercent: { type: number }
 *               barcode: { type: string }
 *               weightGrams: { type: integer }
 *               initialStock: { type: integer }
 *               reorderLevel: { type: integer }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/variants/create',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.createVariantSchema),
  controller.createVariant
);

/**
 * @openapi
 * /api/v1/products/variants/update:
 *   post:
 *     tags: [Catalog]
 *     summary: Update a variant
 *     description: 'Requires permission: `PRODUCT_MANAGE`. MRP may not fall below the selling price.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               sku: { type: string }
 *               sizeMl: { type: integer }
 *               mrp: { type: number }
 *               sellingPrice: { type: number }
 *               taxPercent: { type: number }
 *               status: { $ref: '#/components/schemas/VariantStatus' }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/variants/update',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.updateVariantSchema),
  controller.updateVariant
);

/**
 * @openapi
 * /api/v1/products/variants/delete:
 *   post:
 *     tags: [Catalog]
 *     summary: Delete a variant
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE`. Refused while units are reserved
 *       for open orders, and refused if it is the last variant of a live product.
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
  '/variants/delete',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.idSchema),
  controller.deleteVariant
);

/**
 * @openapi
 * /api/v1/products/images/add:
 *   post:
 *     tags: [Catalog]
 *     summary: Upload product images
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE`.
 *       Multipart: send up to 10 files in the `images` field (JPEG, PNG or WebP),
 *       or pass `imageUrls` for already-hosted images. The first image on a
 *       product with no images becomes the primary one.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId: { type: integer }
 *               altText: { type: string }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Uploaded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/images/add',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  imageUpload.array('images', 10),
  validate(schemas.addImagesSchema),
  controller.addImages
);

/**
 * @openapi
 * /api/v1/products/images/set-primary:
 *   post:
 *     tags: [Catalog]
 *     summary: Choose the primary image
 *     description: 'Requires permission: `PRODUCT_MANAGE`. Exactly one image is primary per product.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/images/set-primary',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.idSchema),
  controller.setPrimaryImage
);

/**
 * @openapi
 * /api/v1/products/images/delete:
 *   post:
 *     tags: [Catalog]
 *     summary: Delete a product image
 *     description: |
 *       Requires permission: `PRODUCT_MANAGE`. If the primary image is removed,
 *       the next image is promoted so a product is never left without one.
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
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/images/delete',
  authorize(PERMISSIONS.PRODUCT_MANAGE),
  validate(schemas.idSchema),
  controller.deleteImage
);

module.exports = router;
