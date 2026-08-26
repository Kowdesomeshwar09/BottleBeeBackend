'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Review, Order, OrderItem, Product, Vendor, DeliveryPartner,
  DeliveryAssignment, CustomerProfile, User,
} = require('../models');
const { ORDER_STATUS, REVIEW_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const {
  ok, created, paginated, updated, fail,
} = require('../utils/response');
const notificationService = require('../services/notification.service');
const vendorAccessService = require('../services/vendorAccess.service');

/**
 * Reviews and moderation.
 *
 * Only verified purchases can be reviewed: the order must be DELIVERED, must
 * belong to the reviewer, and — for a product review — must actually contain
 * that product. Without those checks a review section is worth nothing, because
 * anyone could praise or attack any listing.
 *
 * Reviews land as PENDING and are invisible publicly until moderated. Rating
 * aggregates on the product, store or partner are recomputed from approved
 * reviews only, in the same transaction as the moderation decision, so a
 * displayed average always matches the reviews a visitor can actually read.
 */

const SORTABLE = ['id', 'rating', 'status', 'createdAt', 'moderatedAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serialize = (review, { includeReviewer = false } = {}) => ({
  id: review.id,
  userId: includeReviewer ? review.userId : undefined,
  orderId: review.orderId,
  productId: review.productId,
  vendorId: review.vendorId,
  deliveryPartnerId: review.deliveryPartnerId,
  rating: review.rating,
  title: review.title,
  comment: review.comment,
  status: review.status,
  moderationNote: review.moderationNote,
  moderatedBy: review.moderatedBy,
  moderatedAt: review.moderatedAt,
  createdAt: review.createdAt,
  // Publicly only a first name is exposed; moderators see the full identity.
  reviewer: review.user
    ? (includeReviewer
      ? {
        id: review.user.id,
        name: [review.user.firstName, review.user.lastName].filter(Boolean).join(' '),
        email: review.user.email,
      }
      : review.user.firstName)
    : undefined,
  product: review.product
    ? { id: review.product.id, name: review.product.name }
    : undefined,
  vendor: review.vendor
    ? { id: review.vendor.id, businessName: review.vendor.businessName }
    : undefined,
});

/** Which of the three subjects this review targets. */
const subjectOf = (body) => {
  if (body.productId) return { key: 'productId', model: Product, label: 'product' };
  if (body.vendorId) return { key: 'vendorId', model: Vendor, label: 'store' };
  if (body.deliveryPartnerId) {
    return { key: 'deliveryPartnerId', model: DeliveryPartner, label: 'delivery partner' };
  }
  return null;
};

/**
 * Recomputes a subject's rating from its APPROVED reviews only.
 *
 * Derived from the reviews rather than incremented, so the displayed average can
 * never drift from what a visitor can actually read — including after a review
 * is later hidden or rejected.
 */
async function recomputeRating(subjectKey, subjectId, transaction) {
  const [row] = await Review.findAll({
    where: { [subjectKey]: subjectId, status: REVIEW_STATUS.APPROVED, isActive: true },
    attributes: [
      [sequelize.fn('AVG', sequelize.col('rating')), 'avg'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    raw: true,
    transaction,
  });

  const ratingAvg = Number(row?.avg || 0);
  const ratingCount = Number(row?.count || 0);

  const targets = {
    productId: Product,
    vendorId: Vendor,
    deliveryPartnerId: DeliveryPartner,
  };

  await targets[subjectKey].update(
    { ratingAvg: Math.round(ratingAvg * 100) / 100, ratingCount },
    { where: { id: subjectId }, transaction }
  );

  return { ratingAvg, ratingCount };
}

/* -------------------------------------------------------------------------- */
/*                              SUBMIT A REVIEW                               */
/* -------------------------------------------------------------------------- */
const submit = async (req, res) => {
  try {
    const subject = subjectOf(req.body);
    if (!subject) {
      return fail(res, 'Specify exactly one of productId, vendorId or deliveryPartnerId', 422);
    }

    const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) return fail(res, 'Only customers can leave reviews', 403);

    const order = await Order.findOne({
      where: { id: req.body.orderId, customerId: profile.id },
      include: [{ model: OrderItem, as: 'items', attributes: ['productId'] }],
    });
    if (!order) return fail(res, 'That order was not found on your account', 404);

    // A review is only meaningful once the goods have actually arrived.
    if (order.status !== ORDER_STATUS.DELIVERED) {
      return fail(
        res,
        'You can review an order once it has been delivered',
        409,
        [{ code: 'ORDER_NOT_DELIVERED', status: order.status }]
      );
    }

    // Each subject must genuinely relate to the order being reviewed.
    if (subject.key === 'productId') {
      const bought = (order.items || []).some(
        (i) => Number(i.productId) === Number(req.body.productId)
      );
      if (!bought) return fail(res, 'That product was not part of this order', 409);
    }

    if (subject.key === 'vendorId' && Number(order.vendorId) !== Number(req.body.vendorId)) {
      return fail(res, 'That store did not fulfil this order', 409);
    }

    if (subject.key === 'deliveryPartnerId') {
      const assignment = await DeliveryAssignment.findOne({
        where: { orderId: order.id, deliveryPartnerId: req.body.deliveryPartnerId },
        paranoid: false,
      });
      if (!assignment) return fail(res, 'That partner did not deliver this order', 409);
    }

    const existing = await Review.findOne({
      where: {
        orderId: order.id,
        userId: req.user.id,
        [subject.key]: req.body[subject.key],
      },
    });
    if (existing) {
      return fail(res, `You have already reviewed this ${subject.label} for this order`, 409);
    }

    const review = await Review.create({
      userId: req.user.id,
      orderId: order.id,
      productId: req.body.productId || null,
      vendorId: req.body.vendorId || null,
      deliveryPartnerId: req.body.deliveryPartnerId || null,
      rating: req.body.rating,
      title: req.body.title || null,
      comment: req.body.comment || null,
      status: REVIEW_STATUS.PENDING,
      createdBy: req.user.id,
    });

    return created(
      res,
      serialize(review),
      'Thank you. Your review will appear once it has been checked.'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error submitting review', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          PUBLIC REVIEWS FOR A SUBJECT                      */
/* -------------------------------------------------------------------------- */
/** Approved reviews only, with a rating distribution for the summary bars. */
const publicList = async (req, res) => {
  try {
    const subject = subjectOf(req.body);
    if (!subject) {
      return fail(res, 'Specify one of productId, vendorId or deliveryPartnerId', 422);
    }

    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {
      [subject.key]: req.body[subject.key],
      status: REVIEW_STATUS.APPROVED,
      isActive: true,
    };
    if (req.body.rating) where.rating = req.body.rating;

    const result = await Review.findAndCountAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName'] }],
      limit,
      offset,
      order,
      distinct: true,
    });

    const distribution = await Review.findAll({
      where: {
        [subject.key]: req.body[subject.key],
        status: REVIEW_STATUS.APPROVED,
        isActive: true,
      },
      attributes: ['rating', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['rating'],
      raw: true,
    });

    const byRating = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribution.forEach((d) => { byRating[d.rating] = Number(d.count); });

    const total = Object.values(byRating).reduce((a, b) => a + b, 0);
    const weighted = Object.entries(byRating)
      .reduce((sum, [stars, count]) => sum + Number(stars) * count, 0);

    return paginated(
      res,
      result.rows.map((r) => serialize(r)),
      toPageMeta(result, { page, limit }),
      'Reviews fetched successfully',
      {
        summary: {
          averageRating: total ? Math.round((weighted / total) * 100) / 100 : 0,
          totalReviews: total,
          distribution: byRating,
        },
      }
    );
  } catch (error) {
    return fail(res, 'Error fetching reviews', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                                MY REVIEWS                                  */
/* -------------------------------------------------------------------------- */
const myReviews = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = { userId: req.user.id };
    if (req.body.status) where.status = req.body.status;

    const result = await Review.findAndCountAll({
      where,
      include: [
        { model: Product, as: 'product', attributes: ['id', 'name'], required: false },
        { model: Vendor, as: 'vendor', attributes: ['id', 'businessName'], required: false },
      ],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((r) => serialize(r)),
      toPageMeta(result, { page, limit }),
      'Your reviews fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching your reviews', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                         MODERATION QUEUE (STAFF)                           */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.rating) where.rating = req.body.rating;
    if (req.body.productId) where.productId = req.body.productId;
    if (req.body.vendorId) where.vendorId = req.body.vendorId;
    if (req.body.deliveryPartnerId) where.deliveryPartnerId = req.body.deliveryPartnerId;
    if (req.body.search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${req.body.search}%` } },
        { comment: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    // A vendor user may read reviews of their own stores, never the whole queue.
    if (!vendorAccessService.isStaff(req)) {
      const ids = await vendorAccessService.myVendorIds(req);
      if (!ids.length) {
        return paginated(res, [], { page, limit, total: 0 }, 'Reviews fetched successfully');
      }
      where.vendorId = { [Op.in]: ids };
    }

    const result = await Review.findAndCountAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email'] },
        { model: Product, as: 'product', attributes: ['id', 'name'], required: false },
        { model: Vendor, as: 'vendor', attributes: ['id', 'businessName'], required: false },
      ],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((r) => serialize(r, { includeReviewer: true })),
      toPageMeta(result, { page, limit }),
      'Reviews fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching reviews', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             MODERATE A REVIEW                              */
/* -------------------------------------------------------------------------- */
/**
 * Approve, reject or hide. The subject's rating aggregate is recomputed in the
 * same transaction, so an average never counts a review a visitor cannot read.
 */
const moderate = async (req, res) => {
  try {
    const review = await Review.findByPk(req.body.id);
    if (!review) return fail(res, 'Review not found', 404);

    if (review.status === req.body.status) {
      return fail(res, `This review is already ${req.body.status.toLowerCase()}`, 409);
    }

    const needsNote = [REVIEW_STATUS.REJECTED, REVIEW_STATUS.HIDDEN].includes(req.body.status);
    if (needsNote && !req.body.moderationNote) {
      return fail(res, 'A moderation note is required', 422, [
        { field: 'moderationNote', message: `Required when setting status to ${req.body.status}` },
      ]);
    }

    const previous = review.status;

    const subjectKey = review.productId
      ? 'productId'
      : (review.vendorId ? 'vendorId' : 'deliveryPartnerId');
    const subjectId = review[subjectKey];

    const rating = await sequelize.transaction(async (transaction) => {
      await review.update(
        {
          status: req.body.status,
          moderationNote: req.body.moderationNote || null,
          moderatedBy: req.user.id,
          moderatedAt: new Date(),
          updatedBy: req.user.id,
        },
        { transaction }
      );

      return recomputeRating(subjectKey, subjectId, transaction);
    });

    await recordAudit({
      action: AUDIT_ACTIONS.REVIEW_MODERATED,
      entityType: 'Review',
      entityId: review.id,
      oldValues: { status: previous },
      newValues: { status: req.body.status, note: req.body.moderationNote || null },
      req,
    });

    if (req.body.status === REVIEW_STATUS.REJECTED) {
      await notificationService.notify({
        userId: review.userId,
        templateCode: 'REVIEW_REJECTED',
        title: 'Your review was not published',
        message: `Your review could not be published: ${req.body.moderationNote}`,
        referenceType: 'Review',
        referenceId: review.id,
      });
    }

    return updated(
      res,
      { ...serialize(review, { includeReviewer: true }), subjectRating: rating },
      `Review ${req.body.status.toLowerCase()} successfully`
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error moderating review', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            DELETE MY REVIEW                                */
/* -------------------------------------------------------------------------- */
const remove = async (req, res) => {
  try {
    const review = await Review.findOne({ where: { id: req.body.id, userId: req.user.id } });
    if (!review) return fail(res, 'Review not found', 404);

    const subjectKey = review.productId
      ? 'productId'
      : (review.vendorId ? 'vendorId' : 'deliveryPartnerId');
    const subjectId = review[subjectKey];

    await sequelize.transaction(async (transaction) => {
      await review.update({ isActive: false, deletedBy: req.user.id }, { transaction });
      await review.destroy({ transaction });
      // Removing an approved review has to move the average with it.
      await recomputeRating(subjectKey, subjectId, transaction);
    });

    return ok(res, { deleted: true }, 'Review deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting review', 500, [{ message: error.message }]);
  }
};

module.exports = { submit, publicList, myReviews, list, moderate, remove, serialize };
