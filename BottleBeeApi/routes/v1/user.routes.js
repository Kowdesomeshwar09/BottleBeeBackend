'use strict';

const express = require('express');

const controller = require('../../controllers/user.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/user.validator');

const router = express.Router();

// Every route in this module requires a signed-in user.

/**
 * @openapi
 * /api/v1/users/list:
 *   post:
 *     tags: [Users]
 *     summary: List users
 *     description: 'Paginated user list. Requires permission: `USER_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   accountStatus: { $ref: '#/components/schemas/AccountStatus' }
 *                   roleCode: { type: string, example: CUSTOMER }
 *                   isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Users
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/list',
  validate(schemas.listUsersSchema),
  authenticate,
  authorize(PERMISSIONS.USER_VIEW),
  controller.list
);

/**
 * @openapi
 * /api/v1/users/detail:
 *   post:
 *     tags: [Users]
 *     summary: Get one user
 *     description: 'Requires permission: `USER_VIEW`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: User
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
  authorize(PERMISSIONS.USER_VIEW),
  controller.detail
);

/**
 * @openapi
 * /api/v1/users/create:
 *   post:
 *     tags: [Users]
 *     summary: Create a user
 *     description: |
 *       Creates a staff, vendor, customer or delivery-partner account.
 *       Requires permission: `USER_CREATE`.
 *       Only a SUPER_ADMIN may include `SUPER_ADMIN` in `roleCodes`.
 *       `dateOfBirth` is mandatory when `roleCodes` contains `CUSTOMER`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, email, phone, password, roleCodes]
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string, example: "+919876543210" }
 *               password: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               accountStatus: { $ref: '#/components/schemas/AccountStatus' }
 *               roleCodes:
 *                 type: array
 *                 items: { type: string }
 *                 example: [SUPPORT_AGENT]
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/create',
  validate(schemas.createUserSchema),
  authenticate,
  authorize(PERMISSIONS.USER_CREATE),
  controller.create
);

/**
 * @openapi
 * /api/v1/users/update:
 *   post:
 *     tags: [Users]
 *     summary: Update a user
 *     description: 'Requires permission: `USER_UPDATE`. Email and roles are changed through their own endpoints.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               phone: { type: string }
 *               profileImageUrl: { type: string }
 *               dateOfBirth: { type: string, format: date }
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
  validate(schemas.updateUserSchema),
  authenticate,
  authorize(PERMISSIONS.USER_UPDATE),
  controller.update
);

/**
 * @openapi
 * /api/v1/users/change-status:
 *   post:
 *     tags: [Users]
 *     summary: Suspend, block, activate or restore an account
 *     description: |
 *       Requires permission: `USER_UPDATE`.
 *       Suspending, blocking or deleting revokes every active session immediately.
 *       You cannot change your own status, and only a SUPER_ADMIN may act on another SUPER_ADMIN.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, accountStatus]
 *             properties:
 *               id: { type: integer }
 *               accountStatus: { $ref: '#/components/schemas/AccountStatus' }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Status changed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/change-status',
  validate(schemas.changeStatusSchema),
  authenticate,
  authorize(PERMISSIONS.USER_UPDATE),
  controller.changeStatus
);

/**
 * @openapi
 * /api/v1/users/delete:
 *   post:
 *     tags: [Users]
 *     summary: Soft delete a user
 *     description: |
 *       Requires permission: `USER_DELETE`. The row is retained so historical
 *       orders stay attributable; sessions are revoked.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/delete',
  validate(schemas.deleteUserSchema),
  authenticate,
  authorize(PERMISSIONS.USER_DELETE),
  controller.remove
);

/**
 * @openapi
 * /api/v1/users/reset-password:
 *   post:
 *     tags: [Users]
 *     summary: Set a user's password (admin)
 *     description: 'Requires permission: `USER_UPDATE`. Revokes all sessions for that user.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, password]
 *             properties:
 *               id: { type: integer }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Password reset
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/reset-password',
  validate(schemas.resetUserPasswordSchema),
  authenticate,
  authorize(PERMISSIONS.USER_UPDATE),
  controller.resetPassword
);

/**
 * @openapi
 * /api/v1/users/unlock:
 *   post:
 *     tags: [Users]
 *     summary: Clear a failed-login lockout
 *     description: 'Requires permission: `USER_UPDATE`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Unlocked
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/unlock',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.USER_UPDATE),
  controller.unlock
);

module.exports = router;
