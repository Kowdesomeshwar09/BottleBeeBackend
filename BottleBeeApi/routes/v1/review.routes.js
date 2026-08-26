'use strict';

const express = require('express');

const controller = require('../../controllers/review.controller');
const validate = require('../../middlewares/validate');
const { authenticate, optionalAuthenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/review.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/reviews/public-list:
 *   post:
 *     tags: [Reviews]
 *     summary: Approved reviews for a product, store or delivery partner
 *     description: |
 *       Public. Returns only APPROVED reviews, plus a `summary` carrying the
 *       average and the star distribution across the whole result set — enough
 *       to render the rating bars without a second call.
 *
 *       Only the reviewer's first name is exposed.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   productId: { type: integer }
 *                   vendorId: { type: integer }
 *                   deliveryPartnerId: { type: integer }
 *                   rating: { type: integer, minimum: 1, maximum: 5 }
 *     responses:
 *       200:
 *         description: Reviews plus a rating summary
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     summary:
 *                       type: object
 *                       properties:
 *                         averageRating: { type: number, example: 4.3 }
 *                         totalReviews: { type: integer, example: 128 }
 *                         distribution: { type: object }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/public-list',
  validate(schemas.publicListSchema),
  optionalAuthenticate,
  controller.publicList
);

/**
 * @openapi
 * /api/v1/reviews/submit:
 *   post:
 *     tags: [Reviews]
 *     summary: Review a delivered order
 *     description: |
 *       Requires permission: `REVIEW_SUBMIT`.
 *
 *       Verified purchases only. The order must be DELIVERED and belong to you;
 *       a product review must name a product that was actually in it, a store
 *       review the store that fulfilled it, and a partner review the rider who
 *       delivered it. Without those checks a review section is worth nothing.
 *
 *       Exactly one subject per review, and one review per subject per order.
 *       Reviews land as PENDING and appear publicly only once moderated.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, rating]
 *             properties:
 *               orderId: { type: integer }
 *               productId: { type: integer }
 *               vendorId: { type: integer }
 *               deliveryPartnerId: { type: integer }
 *               rating: { type: integer, minimum: 1, maximum: 5, example: 5 }
 *               title: { type: string, example: Arrived cold and on time }
 *               comment: { type: string }
 *     responses:
 *       201:
 *         description: Review submitted for moderation
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Order not delivered, subject unrelated to the order, or already reviewed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/submit',
  validate(schemas.submitSchema),
  authenticate,
  authorize(PERMISSIONS.REVIEW_SUBMIT),
  controller.submit
);

/**
 * @openapi
 * /api/v1/reviews/my-reviews:
 *   post:
 *     tags: [Reviews]
 *     summary: Reviews you have written
 *     description: 'Requires permission: `REVIEW_SUBMIT`. Includes those still pending moderation.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/ReviewStatus' }
 *     responses:
 *       200:
 *         description: Your reviews
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/my-reviews',
  validate(schemas.myReviewsSchema),
  authenticate,
  authorize(PERMISSIONS.REVIEW_SUBMIT),
  controller.myReviews
);

/**
 * @openapi
 * /api/v1/reviews/delete:
 *   post:
 *     tags: [Reviews]
 *     summary: Delete your own review
 *     description: |
 *       Requires permission: `REVIEW_SUBMIT`. Soft delete. If the review was
 *       approved, the subject's rating average is recomputed so it stops
 *       counting a review nobody can read.
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
  '/delete',
  validate(schemas.idSchema),
  authenticate,
  authorize(PERMISSIONS.REVIEW_SUBMIT),
  controller.remove
);

/**
 * @openapi
 * /api/v1/reviews/list:
 *   post:
 *     tags: [Reviews]
 *     summary: Moderation queue
 *     description: |
 *       Requires permission: `REVIEW_VIEW`. Staff see every review including
 *       PENDING; a vendor user sees only reviews of their own stores. The full
 *       reviewer identity is included, unlike the public listing.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/ReviewStatus' }
 *                   rating: { type: integer }
 *                   productId: { type: integer }
 *                   vendorId: { type: integer }
 *     responses:
 *       200:
 *         description: Reviews
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/list',
  validate(schemas.listSchema),
  authenticate,
  authorize(PERMISSIONS.REVIEW_VIEW),
  controller.list
);

/**
 * @openapi
 * /api/v1/reviews/moderate:
 *   post:
 *     tags: [Reviews]
 *     summary: Approve, reject or hide a review
 *     description: |
 *       Requires permission: `REVIEW_MODERATE`. Rejecting or hiding requires a
 *       note, and a rejection is sent to the reviewer with that reason.
 *
 *       The subject's rating average and count are recomputed from its approved
 *       reviews in the same transaction, so a displayed average always matches
 *       the reviews a visitor can actually read.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { $ref: '#/components/schemas/ReviewStatus' }
 *               moderationNote: { type: string, description: Required for REJECTED or HIDDEN. }
 *     responses:
 *       200:
 *         description: Moderated; the recomputed subject rating is returned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/moderate',
  validate(schemas.moderateSchema),
  authenticate,
  authorize(PERMISSIONS.REVIEW_MODERATE),
  controller.moderate
);

module.exports = router;
