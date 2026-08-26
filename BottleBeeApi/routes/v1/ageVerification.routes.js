'use strict';

const express = require('express');

const controller = require('../../controllers/ageVerification.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { documentUpload } = require('../../middlewares/upload');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/ageVerification.validator');

const router = express.Router();


/**
 * @openapi
 * /api/v1/age-verifications/submit:
 *   post:
 *     tags: [Age Verification]
 *     summary: Submit identity documents for age verification
 *     description: |
 *       Requires permission: `AGE_VERIFICATION_SUBMIT`.
 *       Multipart request: `documentFront`, `documentBack` and `selfie` are files
 *       (JPEG, PNG, WebP or PDF, up to UPLOAD_MAX_SIZE_MB each); the rest are text fields.
 *
 *       The document number is hashed with a keyed HMAC and never stored in the clear.
 *       The date of birth must match the one on your customer profile, and an
 *       under-age submission is rejected immediately rather than queued for review.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [documentType, documentNumber, dateOfBirth]
 *             properties:
 *               documentType: { $ref: '#/components/schemas/DocumentType' }
 *               documentNumber: { type: string, example: "XXXX-XXXX-1234" }
 *               dateOfBirth: { type: string, format: date, example: "1995-04-12" }
 *               documentFront: { type: string, format: binary }
 *               documentBack: { type: string, format: binary }
 *               selfie: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Submitted for review
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Under the legal drinking age
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/submit',
  documentUpload.fields([
    { name: 'documentFront', maxCount: 1 },
    { name: 'documentBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ]),
  validate(schemas.submitSchema),
  authenticate,
  authorize(PERMISSIONS.AGE_VERIFICATION_SUBMIT),
  controller.submit
);

/**
 * @openapi
 * /api/v1/age-verifications/my-status:
 *   post:
 *     tags: [Age Verification]
 *     summary: Your current verification state
 *     description: 'Requires permission: `AGE_VERIFICATION_SUBMIT`. Returns whether you are verified and whether you may submit again.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Status
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/my-status',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.AGE_VERIFICATION_SUBMIT),
  controller.myStatus
);

/**
 * @openapi
 * /api/v1/age-verifications/eligibility:
 *   post:
 *     tags: [Age Verification]
 *     summary: Are you currently allowed to buy alcohol?
 *     description: |
 *       Requires permission: `AGE_VERIFICATION_SUBMIT`.
 *       Evaluates age, verification state and regional rules, returning every
 *       blocking reason so the cart can explain the problem before checkout.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Eligibility report
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post(
  '/eligibility',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.AGE_VERIFICATION_SUBMIT),
  controller.eligibility
);

/**
 * @openapi
 * /api/v1/age-verifications/list:
 *   post:
 *     tags: [Age Verification]
 *     summary: List submissions for review
 *     description: 'Requires permission: `AGE_VERIFICATION_VIEW`. Document images are not included in list results.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/VerificationStatus' }
 *                   userId: { type: integer }
 *     responses:
 *       200:
 *         description: Submissions
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/list',
  validate(schemas.listSchema),
  authenticate,
  authorize(PERMISSIONS.AGE_VERIFICATION_VIEW),
  controller.list
);

/**
 * @openapi
 * /api/v1/age-verifications/detail:
 *   post:
 *     tags: [Age Verification]
 *     summary: Get one submission including document images
 *     description: 'Requires permission: `AGE_VERIFICATION_VIEW`. Every access is written to the audit log.'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Submission
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
  authorize(PERMISSIONS.AGE_VERIFICATION_VIEW),
  controller.detail
);

/**
 * @openapi
 * /api/v1/age-verifications/review:
 *   post:
 *     tags: [Age Verification]
 *     summary: Approve or reject a submission
 *     description: |
 *       Requires permission: `AGE_VERIFICATION_REVIEW`.
 *       Approving marks the customer profile verified so checkout can proceed and
 *       sets a two-year re-verification date. Rejecting requires a reason, which
 *       is shown to the customer.
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
 *               rejectionReason: { type: string, description: Required when rejecting. }
 *     responses:
 *       200:
 *         description: Reviewed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/review',
  validate(schemas.reviewSchema),
  authenticate,
  authorize(PERMISSIONS.AGE_VERIFICATION_REVIEW),
  controller.review
);

/**
 * @openapi
 * /api/v1/age-verifications/expire-lapsed:
 *   post:
 *     tags: [Age Verification]
 *     summary: Expire verifications past their validity date
 *     description: |
 *       Requires permission: `AGE_VERIFICATION_REVIEW`.
 *       Marks lapsed approvals EXPIRED and clears the corresponding profile flags,
 *       so those customers must re-verify before ordering again. Intended for a
 *       scheduled job; exposed here so it can also be run on demand.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Expired
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/expire-lapsed',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.AGE_VERIFICATION_REVIEW),
  controller.expireLapsed
);

module.exports = router;
