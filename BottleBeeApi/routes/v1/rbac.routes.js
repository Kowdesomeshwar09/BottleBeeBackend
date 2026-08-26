'use strict';

const express = require('express');

const controller = require('../../controllers/rbac.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/rbac.validator');

const router = express.Router();


/**
 * @openapi
 * /api/v1/rbac/roles/list:
 *   post:
 *     tags: [RBAC]
 *     summary: List roles with their permissions
 *     description: 'Requires permission: `ROLE_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ListRequest' }
 *     responses:
 *       200:
 *         description: Roles
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/roles/list',
  validate(schemas.listRolesSchema),
  authenticate,
  authorize(PERMISSIONS.ROLE_VIEW),
  controller.listRoles
);

/**
 * @openapi
 * /api/v1/rbac/roles/detail:
 *   post:
 *     tags: [RBAC]
 *     summary: Get one role
 *     description: 'Requires permission: `ROLE_VIEW`.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Role
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  '/roles/detail',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.ROLE_VIEW),
  controller.getRole
);

/**
 * @openapi
 * /api/v1/rbac/roles/create:
 *   post:
 *     tags: [RBAC]
 *     summary: Create a custom role
 *     description: 'Requires permission: `ROLE_MANAGE`. The created role is never a system role.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, name]
 *             properties:
 *               code: { type: string, example: REGIONAL_MANAGER }
 *               name: { type: string, example: Regional Manager }
 *               description: { type: string }
 *               permissionCodes:
 *                 type: array
 *                 items: { type: string }
 *                 example: [ORDER_VIEW, VENDOR_VIEW]
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
  '/roles/create',
  validate(schemas.createRoleSchema),
  authenticate,
  authorize(PERMISSIONS.ROLE_MANAGE),
  controller.createRole
);

/**
 * @openapi
 * /api/v1/rbac/roles/update:
 *   post:
 *     tags: [RBAC]
 *     summary: Update a role
 *     description: 'Requires permission: `ROLE_MANAGE`. A system role''s code cannot be changed.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               code: { type: string }
 *               name: { type: string }
 *               description: { type: string }
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
  '/roles/update',
  validate(schemas.updateRoleSchema),
  authenticate,
  authorize(PERMISSIONS.ROLE_MANAGE),
  controller.updateRole
);

/**
 * @openapi
 * /api/v1/rbac/roles/delete:
 *   post:
 *     tags: [RBAC]
 *     summary: Delete a custom role
 *     description: |
 *       Requires permission: `ROLE_MANAGE`. System roles cannot be deleted, and a
 *       role that is still assigned to users is refused with 409.
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
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/roles/delete',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.ROLE_MANAGE),
  controller.deleteRole
);

/**
 * @openapi
 * /api/v1/rbac/permissions/list:
 *   post:
 *     tags: [RBAC]
 *     summary: List permissions
 *     description: 'Requires permission: `PERMISSION_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   module: { type: string, example: ORDER }
 *     responses:
 *       200:
 *         description: Permissions
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/permissions/list',
  validate(schemas.listPermissionsSchema),
  authenticate,
  authorize(PERMISSIONS.PERMISSION_VIEW),
  controller.listPermissions
);

/**
 * @openapi
 * /api/v1/rbac/permissions/matrix:
 *   post:
 *     tags: [RBAC]
 *     summary: Permissions grouped by module, plus every role's grants
 *     description: 'Requires permission: `PERMISSION_VIEW`. Shaped for the admin RBAC screen.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Matrix
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/permissions/matrix',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.PERMISSION_VIEW),
  controller.permissionMatrix
);

/**
 * @openapi
 * /api/v1/rbac/roles/set-permissions:
 *   post:
 *     tags: [RBAC]
 *     summary: Replace a role's permission set
 *     description: |
 *       Requires permission: `PERMISSION_MANAGE`. The supplied list replaces the
 *       existing grants wholesale. Changing SUPER_ADMIN requires SUPER_ADMIN.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roleId, permissionCodes]
 *             properties:
 *               roleId: { type: integer }
 *               permissionCodes:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: Permissions updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/roles/set-permissions',
  validate(schemas.setRolePermissionsSchema),
  authenticate,
  authorize(PERMISSIONS.PERMISSION_MANAGE),
  controller.setRolePermissions
);

/**
 * @openapi
 * /api/v1/rbac/users/assign-roles:
 *   post:
 *     tags: [RBAC]
 *     summary: Replace a user's roles
 *     description: |
 *       Requires permission: `ROLE_MANAGE`. Granting or revoking SUPER_ADMIN
 *       requires SUPER_ADMIN, and the last remaining super administrator cannot
 *       be demoted.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, roleCodes]
 *             properties:
 *               userId: { type: integer }
 *               roleCodes:
 *                 type: array
 *                 items: { type: string }
 *                 example: [VENDOR_MANAGER]
 *     responses:
 *       200:
 *         description: Roles assigned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/users/assign-roles',
  validate(schemas.assignRolesSchema),
  authenticate,
  authorize(PERMISSIONS.ROLE_MANAGE),
  controller.assignRoles
);

module.exports = router;
