'use strict';

const express = require('express');

const controller = require('../../controllers/customer.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/customer.validator');

const router = express.Router();

router.use(authenticate);

/**
 * @openapi
 * /api/v1/customers/profile/save:
 *   post:
 *     tags: [Customer]
 *     summary: Create or update your customer profile
 *     description: |
 *       Requires permission: `CUSTOMER_MANAGE`.
 *       Date of birth is required and, once an age verification has been approved,
 *       becomes immutable — changing it would invalidate the approved check.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [legalFirstName, legalLastName, dateOfBirth]
 *             properties:
 *               legalFirstName: { type: string, example: Ravi }
 *               legalLastName: { type: string, example: Kanth }
 *               dateOfBirth: { type: string, format: date, example: "1995-04-12" }
 *               gender: { $ref: '#/components/schemas/Gender' }
 *               marketingOptIn: { type: boolean }
 *     responses:
 *       200:
 *         description: Profile saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/profile/save',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.saveProfileSchema),
  controller.saveProfile
);

/**
 * @openapi
 * /api/v1/customers/profile/detail:
 *   post:
 *     tags: [Customer]
 *     summary: Your customer profile and address book
 *     description: 'Requires permission: `CUSTOMER_MANAGE`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Profile
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/profile/detail',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.emptySchema),
  controller.getProfile
);

/**
 * @openapi
 * /api/v1/customers/profile/order-summary:
 *   post:
 *     tags: [Customer]
 *     summary: Lifetime order counts and spend
 *     description: 'Requires permission: `CUSTOMER_MANAGE`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Summary
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/profile/order-summary',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.emptySchema),
  controller.orderSummary
);

/**
 * @openapi
 * /api/v1/customers/addresses/list:
 *   post:
 *     tags: [Customer]
 *     summary: List your delivery addresses
 *     description: 'Requires permission: `CUSTOMER_MANAGE`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ListRequest' }
 *     responses:
 *       200:
 *         description: Addresses
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 */
router.post(
  '/addresses/list',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.listAddressesSchema),
  controller.listAddresses
);

/**
 * @openapi
 * /api/v1/customers/addresses/create:
 *   post:
 *     tags: [Customer]
 *     summary: Add a delivery address
 *     description: |
 *       Requires permission: `CUSTOMER_MANAGE`.
 *       The governing compliance region is resolved from the address state and
 *       stored, so later rule evaluation is stable. The first address a customer
 *       adds automatically becomes their default.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientName, phone, addressLine1, city, state, postalCode]
 *             properties:
 *               label: { type: string, example: Home }
 *               recipientName: { type: string }
 *               phone: { type: string, example: "+919876543210" }
 *               addressLine1: { type: string }
 *               addressLine2: { type: string }
 *               city: { type: string, example: Hyderabad }
 *               state: { type: string, example: Telangana }
 *               postalCode: { type: string, example: "500081" }
 *               country: { type: string, default: India }
 *               latitude: { type: number, example: 17.4435 }
 *               longitude: { type: number, example: 78.3772 }
 *               isDefault: { type: boolean }
 *               deliveryInstructions: { type: string }
 *     responses:
 *       201:
 *         description: Address added
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/addresses/create',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.createAddressSchema),
  controller.createAddress
);

/**
 * @openapi
 * /api/v1/customers/addresses/update:
 *   post:
 *     tags: [Customer]
 *     summary: Update a delivery address
 *     description: 'Requires permission: `CUSTOMER_MANAGE`. You may only edit your own addresses.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               label: { type: string }
 *               recipientName: { type: string }
 *               phone: { type: string }
 *               addressLine1: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               postalCode: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       200:
 *         description: Address updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/addresses/update',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.updateAddressSchema),
  controller.updateAddress
);

/**
 * @openapi
 * /api/v1/customers/addresses/set-default:
 *   post:
 *     tags: [Customer]
 *     summary: Make an address your default
 *     description: 'Requires permission: `CUSTOMER_MANAGE`. Exactly one address is default at a time.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Default set
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/addresses/set-default',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.idSchema),
  controller.setDefaultAddress
);

/**
 * @openapi
 * /api/v1/customers/addresses/delete:
 *   post:
 *     tags: [Customer]
 *     summary: Remove a delivery address
 *     description: |
 *       Requires permission: `CUSTOMER_MANAGE`. Soft delete — historical orders
 *       keep their address snapshot. If the deleted address was the default,
 *       another address is promoted automatically.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Address removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/addresses/delete',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.idSchema),
  controller.deleteAddress
);

/**
 * @openapi
 * /api/v1/customers/addresses/check-serviceability:
 *   post:
 *     tags: [Customer]
 *     summary: Can we deliver to this address right now?
 *     description: |
 *       Requires permission: `CUSTOMER_MANAGE`.
 *       Returns the governing region, whether today is a dry day, the permitted
 *       sale window and the per-order caps — without placing an order.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Serviceability report
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/addresses/check-serviceability',
  authorize(PERMISSIONS.CUSTOMER_MANAGE),
  validate(schemas.idSchema),
  controller.checkServiceability
);

/**
 * @openapi
 * /api/v1/customers/admin/list:
 *   post:
 *     tags: [Customer]
 *     summary: List customers (staff)
 *     description: 'Requires permission: `CUSTOMER_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   ageVerified: { type: boolean }
 *     responses:
 *       200:
 *         description: Customers
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/admin/list',
  authorize(PERMISSIONS.CUSTOMER_VIEW),
  validate(schemas.adminListCustomersSchema),
  controller.adminList
);

/**
 * @openapi
 * /api/v1/customers/admin/detail:
 *   post:
 *     tags: [Customer]
 *     summary: Get one customer with addresses (staff)
 *     description: 'Requires permission: `CUSTOMER_VIEW`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Customer
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/admin/detail',
  authorize(PERMISSIONS.CUSTOMER_VIEW),
  validate(schemas.idSchema),
  controller.adminDetail
);

module.exports = router;
