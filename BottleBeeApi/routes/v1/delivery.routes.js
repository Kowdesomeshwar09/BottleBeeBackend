'use strict';

const express = require('express');

const controller = require('../../controllers/delivery.controller');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/authenticate');
const { authorize } = require('../../middlewares/authorize');
const { trackingLimiter } = require('../../middlewares/rateLimiters');
const { documentUpload } = require('../../middlewares/upload');
const { PERMISSIONS } = require('../../config/constants');
const schemas = require('../../validators/delivery.validator');

const router = express.Router();

/**
 * @openapi
 * /api/v1/delivery/partners/save-profile:
 *   post:
 *     tags: [Delivery]
 *     summary: Submit or update your delivery partner details
 *     description: |
 *       Requires permission: `DELIVERY_PARTNER_MANAGE`.
 *       Multipart: `licenseDocument` is the scanned driving licence.
 *
 *       The account starts PENDING and cannot take deliveries until an admin
 *       approves it. Editing details after a rejection returns the account to
 *       PENDING; a suspended account stays suspended.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [vehicleType, vehicleNumber, licenseNumber]
 *             properties:
 *               vehicleType: { $ref: '#/components/schemas/VehicleType' }
 *               vehicleNumber: { type: string, example: TS09EZ4417 }
 *               licenseNumber: { type: string, example: DLTS2026004417 }
 *               licenseDocument: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Details submitted for review
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       200:
 *         description: Details updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/partners/save-profile',
  documentUpload.fields([{ name: 'licenseDocument', maxCount: 1 }]),
  validate(schemas.saveProfileSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  controller.saveProfile
);

/**
 * @openapi
 * /api/v1/delivery/partners/my-profile:
 *   post:
 *     tags: [Delivery]
 *     summary: Your delivery partner profile and workload
 *     description: 'Requires permission: `DELIVERY_PARTNER_MANAGE`. Includes active and completed delivery counts.'
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
  '/partners/my-profile',
  validate(schemas.emptySchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  controller.myProfile
);

/**
 * @openapi
 * /api/v1/delivery/partners/list:
 *   post:
 *     tags: [Delivery]
 *     summary: List delivery partners
 *     description: 'Requires permission: `DELIVERY_VIEW`.'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/DeliveryPartnerStatus' }
 *                   vehicleType: { $ref: '#/components/schemas/VehicleType' }
 *     responses:
 *       200:
 *         description: Partners
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/partners/list',
  validate(schemas.listPartnersSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_VIEW),
  controller.listPartners
);

/**
 * @openapi
 * /api/v1/delivery/partners/review:
 *   post:
 *     tags: [Delivery]
 *     summary: Approve, suspend or reactivate a delivery partner
 *     description: |
 *       Requires permission: `DELIVERY_PARTNER_APPROVE`.
 *
 *       Suspension is refused while the partner has a delivery in transit —
 *       cutting them off mid-run would strand an order at a customer's door.
 *       Reassign first.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { $ref: '#/components/schemas/DeliveryPartnerStatus' }
 *               reason: { type: string, description: Required for SUSPENDED or OFFLINE. }
 *     responses:
 *       200:
 *         description: Reviewed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Already in that status, or has deliveries in transit
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/partners/review',
  validate(schemas.reviewPartnerSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_PARTNER_APPROVE),
  controller.reviewPartner
);

/**
 * @openapi
 * /api/v1/delivery/assign:
 *   post:
 *     tags: [Delivery]
 *     summary: Assign a delivery partner to an order
 *     description: |
 *       Requires permission: `DELIVERY_ASSIGN`. The order must be
 *       READY_FOR_PICKUP and the partner ACTIVE. The order advances to ASSIGNED
 *       in the same transaction, and the partner is notified.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, deliveryPartnerId]
 *             properties:
 *               orderId: { type: integer }
 *               deliveryPartnerId: { type: integer }
 *     responses:
 *       201:
 *         description: Assigned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Order not ready, partner unavailable, or already assigned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/assign',
  validate(schemas.assignSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_ASSIGN),
  controller.assign
);

/**
 * @openapi
 * /api/v1/delivery/respond:
 *   post:
 *     tags: [Delivery]
 *     summary: Accept or decline an assigned delivery
 *     description: |
 *       Requires permission: `DELIVERY_EXECUTE`. Declining requires a reason and
 *       returns the order to the pickup queue so dispatch can reassign it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, accept]
 *             properties:
 *               id: { type: integer, description: Delivery assignment id. }
 *               accept: { type: boolean }
 *               reason: { type: string, description: Required when declining. }
 *     responses:
 *       200:
 *         description: Response recorded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.post(
  '/respond',
  validate(schemas.respondSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_EXECUTE),
  controller.respond
);

/**
 * @openapi
 * /api/v1/delivery/advance:
 *   post:
 *     tags: [Delivery]
 *     summary: Mark picked up, in transit, or failed
 *     description: |
 *       Requires permission: `DELIVERY_EXECUTE`. Moves both the delivery and the
 *       order together, so the customer's tracking screen never shows the two
 *       disagreeing. `FAILED` requires a reason and returns the order for
 *       reassignment.
 *
 *       DELIVERED is not accepted here — use `/delivery/complete`, which checks
 *       the recipient was verified first.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, status]
 *             properties:
 *               id: { type: integer }
 *               status: { type: string, enum: [PICKED_UP, IN_TRANSIT, FAILED] }
 *               note: { type: string }
 *               reason: { type: string, description: Required when FAILED. }
 *     responses:
 *       200:
 *         description: Delivery advanced
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Illegal delivery transition
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/advance',
  validate(schemas.advanceSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_EXECUTE),
  controller.advance
);

/**
 * @openapi
 * /api/v1/delivery/verify-recipient:
 *   post:
 *     tags: [Delivery]
 *     summary: Record the age and identity check at the door
 *     description: |
 *       Requires permission: `DELIVERY_EXECUTE`.
 *
 *       This is the legal handoff check and the last point at which an unlawful
 *       sale can be prevented. It is a separate, audited action rather than a
 *       flag on the completion request, so "I checked their ID" is a distinct
 *       statement by the partner who made it — and `documentType` is mandatory,
 *       because "verified" without naming what was checked is not evidence.
 *
 *       Only possible once the order is in the partner's hands. Recording
 *       `verified: false` fails the delivery and returns the order, which is a
 *       legitimate and legally required outcome.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, verified]
 *             properties:
 *               id: { type: integer, description: Delivery assignment id. }
 *               verified: { type: boolean }
 *               documentType:
 *                 allOf:
 *                   - $ref: '#/components/schemas/DocumentType'
 *                 description: Required when verified is true.
 *               notes: { type: string, description: Required when verified is false. }
 *     responses:
 *       200:
 *         description: Verification recorded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: The order is not yet in your hands
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/verify-recipient',
  validate(schemas.verifyRecipientSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_EXECUTE),
  controller.verifyRecipient
);

/**
 * @openapi
 * /api/v1/delivery/complete:
 *   post:
 *     tags: [Delivery]
 *     summary: Complete the delivery
 *     description: |
 *       Requires permission: `DELIVERY_EXECUTE`.
 *
 *       Refused with 403 `RECIPIENT_NOT_VERIFIED` unless the age check has been
 *       recorded. On success the order becomes DELIVERED, its reserved stock is
 *       converted into a sale, and a cash-on-delivery order is settled — all in
 *       one transaction.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id: { type: integer }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Delivered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: The recipient has not been verified
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/complete',
  validate(schemas.completeSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_EXECUTE),
  controller.complete
);

/**
 * @openapi
 * /api/v1/delivery/update-location:
 *   post:
 *     tags: [Delivery]
 *     summary: Report your current location
 *     description: |
 *       Requires permission: `DELIVERY_EXECUTE`. Rate limited to 60 a minute.
 *
 *       A tracking point is stored only while a delivery is actually live, so the
 *       tracking table does not fill with idle pings.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number, example: 17.4378 }
 *               longitude: { type: number, example: 78.3956 }
 *     responses:
 *       200:
 *         description: Location updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/update-location',
  trackingLimiter,
  validate(schemas.updateLocationSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_EXECUTE),
  controller.updateLocation
);

/**
 * @openapi
 * /api/v1/delivery/list:
 *   post:
 *     tags: [Delivery]
 *     summary: List deliveries
 *     description: |
 *       Requires permission: `DELIVERY_VIEW`. A delivery partner sees only their
 *       own assignments; staff see all. Set `activeOnly` for the live queue.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/ListRequest'
 *               - type: object
 *                 properties:
 *                   status: { $ref: '#/components/schemas/DeliveryAssignmentStatus' }
 *                   orderId: { type: integer }
 *                   deliveryPartnerId: { type: integer }
 *                   activeOnly: { type: boolean }
 *     responses:
 *       200:
 *         description: Deliveries
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedResponse' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/list',
  validate(schemas.listAssignmentsSchema),
  authenticate,
  authorize(PERMISSIONS.DELIVERY_VIEW),
  controller.listAssignments
);

/**
 * @openapi
 * /api/v1/delivery/detail:
 *   post:
 *     tags: [Delivery]
 *     summary: One delivery with its tracking trail and status history
 *     description: |
 *       Requires permission: `DELIVERY_VIEW`, plus access to the underlying order
 *       — the same rules that govern who may read the order itself.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IdRequest' }
 *     responses:
 *       200:
 *         description: Delivery
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
  authorize(PERMISSIONS.DELIVERY_VIEW),
  controller.assignmentDetail
);

module.exports = router;
