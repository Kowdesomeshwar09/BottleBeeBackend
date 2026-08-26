'use strict';

const express = require('express');

const controller = require('../../controllers/auth.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authLimiter, passwordResetLimiter } = require('../../middlewares/rateLimiters');
const schemas = require('../../validators/auth.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a customer, vendor owner or delivery partner
 *     description: |
 *       Creates an account and returns a session immediately.
 *       `accountType` decides the role granted:
 *       `CUSTOMER` also creates a customer profile (date of birth is mandatory),
 *       `VENDOR` grants VENDOR_OWNER so the applicant can submit a store application,
 *       `DELIVERY_PARTNER` grants DELIVERY_PARTNER so they can submit vehicle details.
 *       The account is usable at once, but checkout still requires an approved age verification.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, email, phone, password]
 *             properties:
 *               accountType:
 *                 type: string
 *                 enum: [CUSTOMER, VENDOR, DELIVERY_PARTNER]
 *                 default: CUSTOMER
 *               firstName: { type: string, example: Ravi }
 *               lastName: { type: string, example: Kanth }
 *               email: { type: string, format: email, example: ravi@example.com }
 *               phone: { type: string, example: "+919876543210" }
 *               password: { type: string, example: "Bottle@Bee123" }
 *               confirmPassword: { type: string, example: "Bottle@Bee123" }
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *                 example: "1995-04-12"
 *                 description: Required when accountType is CUSTOMER.
 *               legalFirstName: { type: string }
 *               legalLastName: { type: string }
 *               gender: { $ref: '#/components/schemas/Gender' }
 *               marketingOptIn: { type: boolean, default: false }
 *               deviceId: { type: string }
 *     responses:
 *       201:
 *         description: Account created and signed in
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         user: { $ref: '#/components/schemas/PublicUser' }
 *                         tokens: { $ref: '#/components/schemas/AuthTokens' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/register', authLimiter, validate(schemas.registerSchema), controller.register);

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in with email and password
 *     description: |
 *       Returns an access token and a rotating refresh token.
 *       After `MAX_LOGIN_ATTEMPTS` consecutive failures the account is locked for
 *       `ACCOUNT_LOCK_MINUTES`. Unknown email and wrong password return the same
 *       message so accounts cannot be enumerated.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: admin@bottlebee.in }
 *               password: { type: string, example: "ChangeMe@12345" }
 *               deviceId: { type: string }
 *     responses:
 *       200:
 *         description: Signed in
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         user: { $ref: '#/components/schemas/PublicUser' }
 *                         tokens: { $ref: '#/components/schemas/AuthTokens' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/login', authLimiter, validate(schemas.loginSchema), controller.login);

/**
 * @openapi
 * /api/v1/auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate a refresh token
 *     description: |
 *       Issues a new access and refresh token and revokes the presented one.
 *       Presenting a token that was already rotated is treated as theft: every
 *       session for that user is revoked and the event is written to the audit log.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: New token pair issued
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/refresh-token', authLimiter, validate(schemas.refreshTokenSchema), controller.refreshToken);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: End the current session, or all sessions
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string, description: Session to revoke. Omit to revoke all. }
 *               allDevices: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Session ended
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/logout', authenticate, validate(schemas.logoutSchema), controller.logout);

/**
 * @openapi
 * /api/v1/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset link
 *     description: |
 *       Always reports success, whether or not the email exists, so the endpoint
 *       cannot be used to discover registered addresses. Outside production the
 *       one-time token is included in the response so the flow is testable
 *       before a mail transport is configured.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Reset requested
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/forgot-password',
  passwordResetLimiter,
  validate(schemas.forgotPasswordSchema),
  controller.forgotPassword
);

/**
 * @openapi
 * /api/v1/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Complete a password reset
 *     description: Consumes the one-time token and revokes every existing session.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string }
 *               password: { type: string }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password reset
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/reset-password',
  passwordResetLimiter,
  validate(schemas.resetPasswordSchema),
  controller.resetPassword
);

/**
 * @openapi
 * /api/v1/auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change your own password
 *     description: Requires the current password and revokes every existing session.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Password changed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/change-password',
  authenticate,
  validate(schemas.changePasswordSchema),
  controller.changePassword
);

/**
 * @openapi
 * /api/v1/auth/me:
 *   post:
 *     tags: [Auth]
 *     summary: Profile of the signed-in user
 *     description: |
 *       Returns identity, roles, permissions and role-specific context
 *       (customer profile, vendor memberships, delivery partner record).
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
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/me', authenticate, validate(schemas.emptySchema), controller.me);

/**
 * @openapi
 * /api/v1/auth/sessions:
 *   post:
 *     tags: [Auth]
 *     summary: List your active sessions
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Active sessions
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/sessions', authenticate, validate(schemas.emptySchema), controller.sessions);

module.exports = router;
