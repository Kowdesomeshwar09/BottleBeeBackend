'use strict';

const { Op } = require('sequelize');

const logger = require('../config/logger');
const {
  sequelize, Order, DeliveryPartner, DeliveryAssignment, DeliveryTracking,
  DeliveryStatusHistory, User, Vendor, CustomerProfile,
} = require('../models');
const {
  ORDER_STATUS, ORDER_DELIVERY_STATUS, DELIVERY_ASSIGNMENT_STATUS,
  DELIVERY_PARTNER_STATUS, ROLES, AUDIT_ACTIONS,
} = require('../config/constants');
const {
  assertDeliveryTransition, DELIVERY_TO_ORDER_STATUS,
} = require('../utils/orderStateMachine');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const { publicUrl } = require('../middlewares/upload');
const {
  ok, created, paginated, updated, fail,
} = require('../utils/response');
const orderService = require('../services/order.service');
const notificationService = require('../services/notification.service');
const vendorAccessService = require('../services/vendorAccess.service');

/**
 * Delivery: partner onboarding, assignment, live tracking and the handoff.
 *
 * The rule this module exists to enforce: an order cannot be marked delivered
 * until the partner has confirmed the recipient is of legal age. That check is
 * the last point at which the platform can prevent an unlawful sale, and it
 * happens at the door — which is why `recipientVerified` is a stored fact on the
 * assignment, set by an explicit action, rather than a checkbox on the completion
 * request.
 *
 * The delivery status and the order status move together in one transaction, so
 * a customer tracking an order never sees the two disagree.
 */

const ASSIGNMENT_SORTABLE = ['id', 'status', 'assignedAt', 'deliveredAt', 'createdAt'];
const PARTNER_SORTABLE = ['id', 'status', 'ratingAvg', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serializePartner = (partner, extra = {}) => ({
  id: partner.id,
  userId: partner.userId,
  vehicleType: partner.vehicleType,
  vehicleNumber: partner.vehicleNumber,
  licenseNumber: partner.licenseNumber,
  licenseDocumentUrl: partner.licenseDocumentUrl,
  status: partner.status,
  rejectionReason: partner.rejectionReason,
  reviewedBy: partner.reviewedBy,
  reviewedAt: partner.reviewedAt,
  currentLatitude: partner.currentLatitude === null ? null : Number(partner.currentLatitude),
  currentLongitude: partner.currentLongitude === null ? null : Number(partner.currentLongitude),
  locationUpdatedAt: partner.locationUpdatedAt,
  ratingAvg: Number(partner.ratingAvg || 0),
  ratingCount: partner.ratingCount,
  isActive: partner.isActive,
  user: partner.user
    ? {
      id: partner.user.id,
      name: [partner.user.firstName, partner.user.lastName].filter(Boolean).join(' '),
      email: partner.user.email,
      phone: partner.user.phone,
    }
    : undefined,
  ...extra,
});

const serializeAssignment = (assignment, extra = {}) => ({
  id: assignment.id,
  orderId: assignment.orderId,
  deliveryPartnerId: assignment.deliveryPartnerId,
  status: assignment.status,
  assignedAt: assignment.assignedAt,
  acceptedAt: assignment.acceptedAt,
  rejectedAt: assignment.rejectedAt,
  pickedUpAt: assignment.pickedUpAt,
  deliveredAt: assignment.deliveredAt,
  failureReason: assignment.failureReason,
  recipientVerified: assignment.recipientVerified,
  recipientVerificationNotes: assignment.recipientVerificationNotes,
  recipientDocumentType: assignment.recipientDocumentType,
  createdAt: assignment.createdAt,
  order: assignment.order
    ? {
      id: assignment.order.id,
      orderNumber: assignment.order.orderNumber,
      status: assignment.order.status,
      grandTotal: Number(assignment.order.grandTotal),
      deliveryAddress: assignment.order.deliveryAddressSnapshot,
    }
    : undefined,
  partner: assignment.partner ? serializePartner(assignment.partner) : undefined,
  ...extra,
});

/** The delivery partner record for the signed-in user, or throws. */
async function requirePartner(req, { transaction = null } = {}) {
  const partner = await DeliveryPartner.findOne({
    where: { userId: req.user.id },
    transaction,
  });

  if (!partner) {
    throw Object.assign(
      new Error('No delivery partner profile exists for this account. Submit your details first.'),
      { statusCode: 404 }
    );
  }

  return partner;
}

/** Appends a delivery status-history row. */
const recordDeliveryChange = (assignment, from, to, req, note, transaction) =>
  DeliveryStatusHistory.create(
    {
      deliveryAssignmentId: assignment.id,
      fromStatus: from,
      toStatus: to,
      changedBy: req?.user?.id ?? null,
      note: note || null,
      createdBy: req?.user?.id ?? null,
    },
    { transaction }
  );

/**
 * Moves an assignment, and carries the order along with it.
 *
 * Delivery and order status are kept in step inside one transaction: a customer
 * watching the tracking screen should never see a rider "picked up" while the
 * order still reads "ready for pickup".
 */
async function advanceAssignment({ assignment, toStatus, req, note = null, failureReason = null }) {
  return sequelize.transaction(async (transaction) => {
    const from = assignment.status;
    assertDeliveryTransition(from, toStatus);

    const updates = { status: toStatus, updatedBy: req.user.id };
    const now = new Date();

    if (toStatus === DELIVERY_ASSIGNMENT_STATUS.ACCEPTED) updates.acceptedAt = now;
    if (toStatus === DELIVERY_ASSIGNMENT_STATUS.REJECTED) updates.rejectedAt = now;
    if (toStatus === DELIVERY_ASSIGNMENT_STATUS.PICKED_UP) updates.pickedUpAt = now;
    if (toStatus === DELIVERY_ASSIGNMENT_STATUS.DELIVERED) updates.deliveredAt = now;
    if (failureReason) updates.failureReason = failureReason;

    await assignment.update(updates, { transaction });
    await recordDeliveryChange(assignment, from, toStatus, req, note || failureReason, transaction);

    // Carry the order forward when this delivery step implies one.
    const orderStatus = DELIVERY_TO_ORDER_STATUS[toStatus];
    let transitioned = null;

    if (orderStatus) {
      const order = await Order.findByPk(assignment.orderId, {
        include: orderService.orderIncludes,
        transaction,
      });

      if (order && order.status !== orderStatus) {
        transitioned = await orderService.applyStatusTransition({
          order,
          toStatus: orderStatus,
          req,
          transaction,
          note: note || `Delivery ${toStatus.toLowerCase()}`,
        });
      }
    }

    // A rejected or failed delivery frees the order to be reassigned.
    if ([DELIVERY_ASSIGNMENT_STATUS.REJECTED, DELIVERY_ASSIGNMENT_STATUS.FAILED]
      .includes(toStatus)) {
      const order = await Order.findByPk(assignment.orderId, { transaction });

      if (order && order.status === ORDER_STATUS.ASSIGNED) {
        await order.update(
          {
            status: ORDER_STATUS.READY_FOR_PICKUP,
            deliveryStatus: ORDER_DELIVERY_STATUS.PENDING,
            updatedBy: req.user.id,
          },
          { transaction }
        );

        await orderService.recordStatusChange(
          order,
          ORDER_STATUS.ASSIGNED,
          ORDER_STATUS.READY_FOR_PICKUP,
          req,
          failureReason || 'Delivery partner unavailable — returned to the pickup queue',
          transaction
        );
      }

      // The unique key is on order_id, so the rejected row is soft-deleted to
      // let a replacement partner be assigned.
      await assignment.update({ deletedBy: req.user.id }, { transaction });
      await assignment.destroy({ transaction });
    }

    return { assignment, from, to: toStatus, transitioned };
  });
}

/* ========================================================================== */
/*                            PARTNER ONBOARDING                              */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                        SUBMIT MY PARTNER DETAILS                           */
/* -------------------------------------------------------------------------- */
const saveProfile = async (req, res) => {
  try {
    const documentUrl = publicUrl(req.files?.licenseDocument?.[0] || req.file);
    const existing = await DeliveryPartner.findOne({ where: { userId: req.user.id } });

    if (existing) {
      await existing.update({
        vehicleType: req.body.vehicleType ?? existing.vehicleType,
        vehicleNumber: req.body.vehicleNumber ?? existing.vehicleNumber,
        licenseNumber: req.body.licenseNumber ?? existing.licenseNumber,
        licenseDocumentUrl: documentUrl ?? existing.licenseDocumentUrl,
        // Editing details after rejection puts the partner back in the queue.
        status: existing.status === DELIVERY_PARTNER_STATUS.SUSPENDED
          ? existing.status
          : DELIVERY_PARTNER_STATUS.PENDING,
        updatedBy: req.user.id,
      });

      return updated(res, serializePartner(existing), 'Delivery partner details updated');
    }

    const partner = await DeliveryPartner.create({
      userId: req.user.id,
      vehicleType: req.body.vehicleType,
      vehicleNumber: req.body.vehicleNumber,
      licenseNumber: req.body.licenseNumber,
      licenseDocumentUrl: documentUrl,
      status: DELIVERY_PARTNER_STATUS.PENDING,
      createdBy: req.user.id,
    });

    return created(
      res,
      serializePartner(partner),
      'Delivery partner details submitted. An administrator will review them shortly.'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error saving delivery partner details', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             MY PARTNER PROFILE                             */
/* -------------------------------------------------------------------------- */
const myProfile = async (req, res) => {
  try {
    const partner = await requirePartner(req);

    const [active, completed] = await Promise.all([
      DeliveryAssignment.count({
        where: {
          deliveryPartnerId: partner.id,
          status: {
            [Op.in]: [
              DELIVERY_ASSIGNMENT_STATUS.ASSIGNED,
              DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
              DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
              DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT,
            ],
          },
        },
      }),
      DeliveryAssignment.count({
        where: {
          deliveryPartnerId: partner.id,
          status: DELIVERY_ASSIGNMENT_STATUS.DELIVERED,
        },
      }),
    ]);

    return ok(
      res,
      serializePartner(partner, { stats: { activeDeliveries: active, completedDeliveries: completed } }),
      'Delivery partner profile fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching profile', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             LIST PARTNERS                                  */
/* -------------------------------------------------------------------------- */
const listPartners = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: PARTNER_SORTABLE,
    });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.vehicleType) where.vehicleType = req.body.vehicleType;

    const userWhere = {};
    if (req.body.search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${req.body.search}%` } },
        { lastName: { [Op.like]: `%${req.body.search}%` } },
        { email: { [Op.like]: `%${req.body.search}%` } },
        { phone: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await DeliveryPartner.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'user',
        required: true,
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
        ...(Object.keys(userWhere).length ? { where: userWhere } : {}),
      }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((p) => serializePartner(p)),
      toPageMeta(result, { page, limit }),
      'Delivery partners fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching delivery partners', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                     APPROVE OR SUSPEND A PARTNER                           */
/* -------------------------------------------------------------------------- */
const reviewPartner = async (req, res) => {
  try {
    const partner = await DeliveryPartner.findByPk(req.body.id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'email'] }],
    });
    if (!partner) return fail(res, 'Delivery partner not found', 404);

    const previous = partner.status;
    if (previous === req.body.status) {
      return fail(res, `This partner is already ${req.body.status}`, 409);
    }

    const needsReason = [
      DELIVERY_PARTNER_STATUS.SUSPENDED, DELIVERY_PARTNER_STATUS.OFFLINE,
    ].includes(req.body.status);

    if (needsReason && !req.body.reason) {
      return fail(res, 'A reason is required', 422, [
        { field: 'reason', message: `Required when setting status to ${req.body.status}` },
      ]);
    }

    // Suspending someone mid-delivery would strand the order at the customer's door.
    if (req.body.status === DELIVERY_PARTNER_STATUS.SUSPENDED) {
      const live = await DeliveryAssignment.count({
        where: {
          deliveryPartnerId: partner.id,
          status: {
            [Op.in]: [
              DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
              DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT,
            ],
          },
        },
      });

      if (live > 0) {
        return fail(
          res,
          `This partner has ${live} delivery(s) in transit. Reassign them before suspending.`,
          409
        );
      }
    }

    await partner.update({
      status: req.body.status,
      rejectionReason: req.body.reason || null,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      updatedBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.DELIVERY_PARTNER_REVIEWED,
      entityType: 'DeliveryPartner',
      entityId: partner.id,
      oldValues: { status: previous },
      newValues: { status: req.body.status, reason: req.body.reason || null },
      req,
    });

    const messages = {
      [DELIVERY_PARTNER_STATUS.ACTIVE]: 'Your delivery partner account is approved. You can now accept deliveries.',
      [DELIVERY_PARTNER_STATUS.SUSPENDED]: `Your delivery partner account has been suspended: ${req.body.reason}`,
      [DELIVERY_PARTNER_STATUS.OFFLINE]: 'Your delivery partner account has been set offline.',
      [DELIVERY_PARTNER_STATUS.PENDING]: 'Your delivery partner account is under review.',
    };

    await notificationService.notify({
      userId: partner.userId,
      templateCode: `DELIVERY_PARTNER_${req.body.status}`,
      title: 'Delivery partner status updated',
      message: messages[req.body.status] || `Your status is now ${req.body.status}.`,
      referenceType: 'DeliveryPartner',
      referenceId: partner.id,
    });

    return updated(
      res,
      serializePartner(partner),
      `Delivery partner ${req.body.status.toLowerCase()} successfully`
    );
  } catch (error) {
    return fail(res, 'Error reviewing delivery partner', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                ASSIGNMENT                                  */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                        ASSIGN A DELIVERY PARTNER                           */
/* -------------------------------------------------------------------------- */
const assign = async (req, res) => {
  try {
    const order = await orderService.loadAuthorizedOrder(req.body.orderId, req);

    if (order.status !== ORDER_STATUS.READY_FOR_PICKUP) {
      return fail(
        res,
        `An order must be READY_FOR_PICKUP to be assigned (this one is ${order.status})`,
        409
      );
    }

    const partner = await DeliveryPartner.findByPk(req.body.deliveryPartnerId, {
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'phone'] }],
    });
    if (!partner) return fail(res, 'Delivery partner not found', 404);

    if (!partner.isAssignable()) {
      return fail(
        res,
        `This partner is ${partner.status} and cannot take deliveries`,
        409
      );
    }

    const existing = await DeliveryAssignment.findOne({ where: { orderId: order.id } });
    if (existing) {
      return fail(res, 'This order already has a delivery assignment', 409);
    }

    const result = await sequelize.transaction(async (transaction) => {
      const assignment = await DeliveryAssignment.create(
        {
          orderId: order.id,
          deliveryPartnerId: partner.id,
          assignedAt: new Date(),
          status: DELIVERY_ASSIGNMENT_STATUS.ASSIGNED,
          recipientVerified: false,
          createdBy: req.user.id,
        },
        { transaction }
      );

      await recordDeliveryChange(
        assignment, null, DELIVERY_ASSIGNMENT_STATUS.ASSIGNED, req, 'Assigned', transaction
      );

      const locked = await Order.findByPk(order.id, {
        include: orderService.orderIncludes,
        transaction,
      });

      const transitioned = await orderService.applyStatusTransition({
        order: locked,
        toStatus: ORDER_STATUS.ASSIGNED,
        req,
        transaction,
        note: `Assigned to delivery partner ${partner.id}`,
      });

      await locked.update(
        { deliveryStatus: ORDER_DELIVERY_STATUS.ASSIGNED, updatedBy: req.user.id },
        { transaction }
      );

      return { assignment, transitioned };
    });

    await recordAudit({
      action: AUDIT_ACTIONS.DELIVERY_ASSIGNED,
      entityType: 'DeliveryAssignment',
      entityId: result.assignment.id,
      newValues: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        deliveryPartnerId: partner.id,
      },
      req,
    });

    await orderService.announceTransition({
      order: result.transitioned.order,
      from: result.transitioned.from,
      to: result.transitioned.to,
      req,
    });

    await notificationService.notify({
      userId: partner.userId,
      templateCode: 'DELIVERY_ASSIGNED',
      title: 'New delivery assigned',
      message: `Order ${order.orderNumber} is ready for pickup. Remember to verify the recipient's age at handover.`,
      referenceType: 'DeliveryAssignment',
      referenceId: result.assignment.id,
      actions: [{ label: 'View delivery', url: `/deliveries/${result.assignment.id}` }],
    });

    return created(
      res,
      serializeAssignment(result.assignment),
      'Delivery partner assigned successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error assigning delivery partner', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                         ACCEPT OR REJECT A DELIVERY                        */
/* -------------------------------------------------------------------------- */
const respond = async (req, res) => {
  try {
    const partner = await requirePartner(req);

    const assignment = await DeliveryAssignment.findOne({
      where: { id: req.body.id, deliveryPartnerId: partner.id },
      include: [{ model: Order, as: 'order', attributes: ['id', 'orderNumber'] }],
    });
    if (!assignment) return fail(res, 'Delivery assignment not found', 404);

    const accepting = req.body.accept === true;
    const toStatus = accepting
      ? DELIVERY_ASSIGNMENT_STATUS.ACCEPTED
      : DELIVERY_ASSIGNMENT_STATUS.REJECTED;

    if (!accepting && !req.body.reason) {
      return fail(res, 'A reason is required when declining a delivery', 422, [
        { field: 'reason', message: 'Required when declining' },
      ]);
    }

    const orderNumber = assignment.order?.orderNumber;

    const result = await advanceAssignment({
      assignment,
      toStatus,
      req,
      note: accepting ? 'Accepted by partner' : null,
      failureReason: accepting ? null : req.body.reason,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.DELIVERY_STATUS_CHANGED,
      entityType: 'DeliveryAssignment',
      entityId: assignment.id,
      oldValues: { status: result.from },
      newValues: { status: toStatus, reason: req.body.reason || null },
      req,
    });

    return updated(
      res,
      { assignmentId: assignment.id, status: toStatus, orderNumber },
      accepting
        ? 'Delivery accepted'
        : 'Delivery declined. The order has returned to the pickup queue.'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error responding to the delivery', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                           PICK UP / IN TRANSIT                             */
/* -------------------------------------------------------------------------- */
const advance = async (req, res) => {
  try {
    const partner = await requirePartner(req);

    const assignment = await DeliveryAssignment.findOne({
      where: { id: req.body.id, deliveryPartnerId: partner.id },
    });
    if (!assignment) return fail(res, 'Delivery assignment not found', 404);

    const result = await advanceAssignment({
      assignment,
      toStatus: req.body.status,
      req,
      note: req.body.note,
      failureReason: req.body.status === DELIVERY_ASSIGNMENT_STATUS.FAILED
        ? req.body.reason
        : null,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.DELIVERY_STATUS_CHANGED,
      entityType: 'DeliveryAssignment',
      entityId: assignment.id,
      oldValues: { status: result.from },
      newValues: { status: req.body.status },
      req,
    });

    if (result.transitioned) {
      await orderService.announceTransition({
        order: result.transitioned.order,
        from: result.transitioned.from,
        to: result.transitioned.to,
        req,
      });
    }

    return updated(
      res,
      serializeAssignment(assignment),
      `Delivery moved to ${req.body.status}`
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error updating the delivery', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          VERIFY THE RECIPIENT                              */
/* -------------------------------------------------------------------------- */
/**
 * The legal handoff check, and the last point at which an unlawful sale can be
 * prevented. Recorded as its own deliberate action rather than a flag on the
 * completion request, so "I checked their ID" is a distinct, audited statement
 * by the partner who made it.
 */
const verifyRecipient = async (req, res) => {
  try {
    const partner = await requirePartner(req);

    const assignment = await DeliveryAssignment.findOne({
      where: { id: req.body.id, deliveryPartnerId: partner.id },
      include: [{ model: Order, as: 'order', attributes: ['id', 'orderNumber'] }],
    });
    if (!assignment) return fail(res, 'Delivery assignment not found', 404);

    const inHand = [
      DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
      DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT,
    ].includes(assignment.status);

    if (!inHand) {
      return fail(
        res,
        `The recipient can only be verified once the order is in your hands (this delivery is ${assignment.status})`,
        409
      );
    }

    if (!req.body.verified) {
      // Refusing the handoff is a legitimate, and legally required, outcome.
      await advanceAssignment({
        assignment,
        toStatus: DELIVERY_ASSIGNMENT_STATUS.FAILED,
        req,
        failureReason: req.body.notes || 'Recipient could not be verified',
      });

      await recordAudit({
        action: AUDIT_ACTIONS.RECIPIENT_VERIFIED,
        entityType: 'DeliveryAssignment',
        entityId: assignment.id,
        newValues: { verified: false, notes: req.body.notes || null },
        req,
      });

      return updated(
        res,
        { assignmentId: assignment.id, verified: false },
        'Recorded as unverified. The delivery has been marked failed and the order returned.'
      );
    }

    await assignment.update({
      recipientVerified: true,
      recipientDocumentType: req.body.documentType,
      recipientVerificationNotes: req.body.notes || null,
      updatedBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.RECIPIENT_VERIFIED,
      entityType: 'DeliveryAssignment',
      entityId: assignment.id,
      newValues: {
        verified: true,
        documentType: req.body.documentType,
        orderNumber: assignment.order?.orderNumber,
      },
      req,
    });

    return updated(
      res,
      serializeAssignment(assignment),
      'Recipient verified. You can now complete the delivery.'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error verifying the recipient', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          COMPLETE THE DELIVERY                             */
/* -------------------------------------------------------------------------- */
const complete = async (req, res) => {
  try {
    const partner = await requirePartner(req);

    const assignment = await DeliveryAssignment.findOne({
      where: { id: req.body.id, deliveryPartnerId: partner.id },
    });
    if (!assignment) return fail(res, 'Delivery assignment not found', 404);

    if (!assignment.recipientVerified) {
      return fail(
        res,
        "You must verify the recipient's age and identity before completing this delivery.",
        403,
        [{ code: 'RECIPIENT_NOT_VERIFIED' }]
      );
    }

    const result = await advanceAssignment({
      assignment,
      toStatus: DELIVERY_ASSIGNMENT_STATUS.DELIVERED,
      req,
      note: req.body.note || 'Delivered and handed over',
    });

    await recordAudit({
      action: AUDIT_ACTIONS.DELIVERY_STATUS_CHANGED,
      entityType: 'DeliveryAssignment',
      entityId: assignment.id,
      oldValues: { status: result.from },
      newValues: { status: DELIVERY_ASSIGNMENT_STATUS.DELIVERED },
      req,
    });

    if (result.transitioned) {
      await orderService.announceTransition({
        order: result.transitioned.order,
        from: result.transitioned.from,
        to: result.transitioned.to,
        req,
      });
    }

    return updated(res, serializeAssignment(assignment), 'Delivery completed. Cheers!');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error completing the delivery', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            UPDATE MY LOCATION                              */
/* -------------------------------------------------------------------------- */
/**
 * High-frequency ping. Writes a tracking point only while a delivery is
 * actually live, so the table does not fill with idle chatter.
 */
const updateLocation = async (req, res) => {
  try {
    const partner = await requirePartner(req);

    await partner.update({
      currentLatitude: req.body.latitude,
      currentLongitude: req.body.longitude,
      locationUpdatedAt: new Date(),
      updatedBy: req.user.id,
    });

    const live = await DeliveryAssignment.findOne({
      where: {
        deliveryPartnerId: partner.id,
        status: {
          [Op.in]: [
            DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
            DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT,
          ],
        },
      },
      order: [['assignedAt', 'DESC']],
    });

    if (live) {
      await DeliveryTracking.create({
        deliveryAssignmentId: live.id,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        recordedAt: new Date(),
        createdBy: req.user.id,
      });
    }

    return ok(
      res,
      {
        latitude: Number(req.body.latitude),
        longitude: Number(req.body.longitude),
        trackedAgainstAssignmentId: live ? live.id : null,
      },
      'Location updated'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error updating location', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            LIST ASSIGNMENTS                                */
/* -------------------------------------------------------------------------- */
const listAssignments = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: ASSIGNMENT_SORTABLE,
      defaultSort: 'assignedAt',
    });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.orderId) where.orderId = req.body.orderId;

    // A delivery partner sees only their own work.
    if (req.user.roles.includes(ROLES.DELIVERY_PARTNER) && !vendorAccessService.isStaff(req)) {
      const partner = await requirePartner(req);
      where.deliveryPartnerId = partner.id;
    } else if (req.body.deliveryPartnerId) {
      where.deliveryPartnerId = req.body.deliveryPartnerId;
    }

    if (req.body.activeOnly) {
      where.status = {
        [Op.in]: [
          DELIVERY_ASSIGNMENT_STATUS.ASSIGNED,
          DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
          DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
          DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT,
        ],
      };
    }

    const result = await DeliveryAssignment.findAndCountAll({
      where,
      include: [
        {
          model: Order,
          as: 'order',
          attributes: ['id', 'orderNumber', 'status', 'grandTotal', 'deliveryAddressSnapshot'],
        },
        {
          model: DeliveryPartner,
          as: 'partner',
          include: [{
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'phone'],
          }],
        },
      ],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((a) => serializeAssignment(a)),
      toPageMeta(result, { page, limit }),
      'Deliveries fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching deliveries', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                    ONE ASSIGNMENT WITH TRACKING TRAIL                      */
/* -------------------------------------------------------------------------- */
const assignmentDetail = async (req, res) => {
  try {
    const assignment = await DeliveryAssignment.findByPk(req.body.id, {
      include: [
        { model: Order, as: 'order' },
        {
          model: DeliveryPartner,
          as: 'partner',
          include: [{
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'phone'],
          }],
        },
      ],
    });
    if (!assignment) return fail(res, 'Delivery assignment not found', 404);

    // Reuse the order's own access rules rather than inventing a second set.
    await orderService.loadAuthorizedOrder(assignment.orderId, req);

    const [tracking, history] = await Promise.all([
      DeliveryTracking.findAll({
        where: { deliveryAssignmentId: assignment.id },
        order: [['recordedAt', 'ASC']],
        attributes: ['latitude', 'longitude', 'recordedAt'],
        limit: 500,
      }),
      DeliveryStatusHistory.findAll({
        where: { deliveryAssignmentId: assignment.id },
        order: [['createdAt', 'ASC']],
        attributes: ['fromStatus', 'toStatus', 'note', 'createdAt'],
      }),
    ]);

    return ok(
      res,
      serializeAssignment(assignment, {
        tracking: tracking.map((t) => ({
          latitude: Number(t.latitude),
          longitude: Number(t.longitude),
          recordedAt: t.recordedAt,
        })),
        statusHistory: history.map((h) => ({
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          note: h.note,
          changedAt: h.createdAt,
        })),
      }),
      'Delivery fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching the delivery', 500, [{ message: error.message }]);
  }
};

module.exports = {
  saveProfile,
  myProfile,
  listPartners,
  reviewPartner,
  assign,
  respond,
  advance,
  verifyRecipient,
  complete,
  updateLocation,
  listAssignments,
  assignmentDetail,
  serializePartner,
  serializeAssignment,
};
