'use strict';

const express = require('express');

const controller = require('../../controllers/vendor.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { documentUpload } = require('../../middlewares/upload');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/vendor.validator');

const router = express.Router();


/**
 * @openapi
 * /api/v1/vendors/apply:
 *   post:
 *     tags: [Vendors]
 *     summary: Submit a store application
 *     description: |
 *       Requires permission: `VENDOR_APPLY`.
 *       Creates the store in PENDING, makes the applicant its OWNER and grants
 *       the VENDOR_OWNER role. The store cannot sell until an admin approves both
 *       it and at least one licence.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [businessName, legalName, email, phone]
 *             properties:
 *               businessName: { type: string, example: Jubilee Wines }
 *               legalName: { type: string, example: Jubilee Wines Pvt Ltd }
 *               email: { type: string, format: email }
 *               phone: { type: string, example: "+919876500001" }
 *               description: { type: string }
 *               deliveryRadiusKm: { type: number, example: 8 }
 *               minOrderAmount: { type: number, example: 500 }
 *               address:
 *                 type: object
 *                 required: [addressLine1, city, state, postalCode]
 *                 properties:
 *                   addressLine1: { type: string }
 *                   addressLine2: { type: string }
 *                   city: { type: string, example: Hyderabad }
 *                   state: { type: string, example: Telangana }
 *                   postalCode: { type: string, example: "500033" }
 *                   latitude: { type: number }
 *                   longitude: { type: number }
 *     responses:
 *       201:
 *         description: Application submitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/apply',
  validate(schemas.applySchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_APPLY),
  controller.apply
);

/**
 * @openapi
 * /api/v1/vendors/my-stores:
 *   post:
 *     tags: [Vendors]
 *     summary: Stores you belong to
 *     description: 'Requires permission: `VENDOR_VIEW`. Returns each store with your role in it.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Your stores
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/my-stores',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_VIEW),
  controller.myVendors
);

/**
 * @openapi
 * /api/v1/vendors/list:
 *   post:
 *     tags: [Vendors]
 *     summary: List stores
 *     description: |
 *       Requires permission: `VENDOR_VIEW`. Staff see every store; a vendor user
 *       sees only the stores they belong to.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/VendorStatus' }
 *                   isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Stores
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 */
router.post(
  '/list',
  validate(schemas.listVendorsSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_VIEW),
  controller.list
);

/**
 * @openapi
 * /api/v1/vendors/detail:
 *   post:
 *     tags: [Vendors]
 *     summary: Get one store with licences, addresses and staff
 *     description: 'Requires permission: `VENDOR_VIEW`. Vendor users may only read their own stores.'
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
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/detail',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_VIEW),
  controller.detail
);

/**
 * @openapi
 * /api/v1/vendors/update:
 *   post:
 *     tags: [Vendors]
 *     summary: Update your store profile
 *     description: |
 *       Requires permission: `VENDOR_MANAGE` and an OWNER or MANAGER membership.
 *       `commissionPercent` is a platform commercial term and is ignored unless
 *       the caller is an admin.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vendorId: { type: integer, description: Required only if you belong to several stores. }
 *               businessName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               description: { type: string }
 *               logoUrl: { type: string }
 *               deliveryRadiusKm: { type: number }
 *               minOrderAmount: { type: number }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/update',
  validate(schemas.updateSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  controller.update
);

/**
 * @openapi
 * /api/v1/vendors/review:
 *   post:
 *     tags: [Vendors]
 *     summary: Approve, reject or suspend a store
 *     description: |
 *       Requires permission: `VENDOR_APPROVE`.
 *       A store cannot be APPROVED until at least one of its licences is approved —
 *       otherwise it would look operational with no legal basis to sell.
 *       REJECTED and SUSPENDED require a reason, which is sent to the owner.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { $ref: '#/components/schemas/VendorStatus' }
 *               reason: { type: string }
 *               commissionPercent: { type: number, example: 12.5 }
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
  validate(schemas.reviewSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_APPROVE),
  controller.review
);

/**
 * @openapi
 * /api/v1/vendors/licenses/add:
 *   post:
 *     tags: [Vendors]
 *     summary: Upload an excise licence
 *     description: |
 *       Requires permission: `VENDOR_LICENSE_MANAGE` and an OWNER or MANAGER membership.
 *       Multipart: `document` is the scanned licence. The licence is region-scoped —
 *       checkout will only allow delivery into a region this store is licensed for.
 *       Licence numbers are unique platform-wide.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [licenseNumber, licenseType, issuingAuthority, regionCode, validFrom, validUntil]
 *             properties:
 *               vendorId: { type: integer }
 *               licenseNumber: { type: string, example: TS-EX-2026-004417 }
 *               licenseType: { type: string, example: FL-2 Retail }
 *               issuingAuthority: { type: string, example: Telangana State Excise Department }
 *               regionCode: { type: string, example: IN-TS }
 *               validFrom: { type: string, format: date }
 *               validUntil: { type: string, format: date }
 *               document: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Licence submitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/licenses/add',
  documentUpload.fields([{ name: 'document', maxCount: 1 }]),
  validate(schemas.addLicenseSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_LICENSE_MANAGE),
  controller.addLicense
);

/**
 * @openapi
 * /api/v1/vendors/licenses/list:
 *   post:
 *     tags: [Vendors]
 *     summary: List licences
 *     description: |
 *       Requires permission: `VENDOR_VIEW`. Vendor users see only their own.
 *       Set `expiringSoon` to list approved licences lapsing within 30 days.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   vendorId: { type: integer }
 *                   status: { $ref: '#/components/schemas/VerificationStatus' }
 *                   regionCode: { type: string }
 *                   expiringSoon: { type: boolean }
 *     responses:
 *       200:
 *         description: Licences
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 */
router.post(
  '/licenses/list',
  validate(schemas.listLicensesSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_VIEW),
  controller.listLicenses
);

/**
 * @openapi
 * /api/v1/vendors/licenses/review:
 *   post:
 *     tags: [Vendors]
 *     summary: Approve or reject a licence
 *     description: 'Requires permission: `VENDOR_LICENSE_REVIEW`. A rejection reason is mandatory and is sent to the owner.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { type: string, enum: [APPROVED, REJECTED] }
 *               rejectionReason: { type: string }
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
  '/licenses/review',
  validate(schemas.reviewLicenseSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_LICENSE_REVIEW),
  controller.reviewLicense
);

/**
 * @openapi
 * /api/v1/vendors/addresses/save:
 *   post:
 *     tags: [Vendors]
 *     summary: Create or update a store address
 *     description: |
 *       Requires permission: `VENDOR_MANAGE` and an OWNER or MANAGER membership.
 *       Pass `id` to update. Exactly one address is primary; the first one added
 *       becomes primary automatically.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressLine1, city, state, postalCode]
 *             properties:
 *               id: { type: integer }
 *               vendorId: { type: integer }
 *               addressLine1: { type: string }
 *               addressLine2: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               postalCode: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               isPrimary: { type: boolean }
 *     responses:
 *       200:
 *         description: Address saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/addresses/save',
  validate(schemas.saveAddressSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  controller.saveAddress
);

/**
 * @openapi
 * /api/v1/vendors/addresses/list:
 *   post:
 *     tags: [Vendors]
 *     summary: List store addresses
 *     description: 'Requires permission: `VENDOR_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Addresses
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/addresses/list',
  validate(schemas.vendorScopeSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_VIEW),
  controller.listAddresses
);

/**
 * @openapi
 * /api/v1/vendors/staff/add:
 *   post:
 *     tags: [Vendors]
 *     summary: Add a manager or staff member
 *     description: |
 *       Requires permission: `VENDOR_STAFF_MANAGE` and an OWNER membership.
 *       The person must already have a Bottle Bee account. Adding a MANAGER also
 *       grants them the VENDOR_MANAGER platform role. Ownership cannot be
 *       transferred here.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, vendorRole]
 *             properties:
 *               vendorId: { type: integer }
 *               email: { type: string, format: email }
 *               vendorRole: { type: string, enum: [MANAGER, STAFF] }
 *     responses:
 *       201:
 *         description: Staff added
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/staff/add',
  validate(schemas.addStaffSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_STAFF_MANAGE),
  controller.addStaff
);

/**
 * @openapi
 * /api/v1/vendors/staff/list:
 *   post:
 *     tags: [Vendors]
 *     summary: List store staff
 *     description: 'Requires permission: `VENDOR_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Staff
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/staff/list',
  validate(schemas.vendorScopeSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_VIEW),
  controller.listStaff
);

/**
 * @openapi
 * /api/v1/vendors/staff/remove:
 *   post:
 *     tags: [Vendors]
 *     summary: Remove a staff member
 *     description: 'Requires permission: `VENDOR_STAFF_MANAGE` and an OWNER membership. The owner cannot be removed.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/staff/remove',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.VENDOR_STAFF_MANAGE),
  controller.removeStaff
);

module.exports = router;
