'use strict';

const { Op } = require('sequelize');

const {
  sequelize, User, Vendor, VendorLicense, Product, Order, Payment, Refund, Review,
  AgeVerification, DeliveryPartner, DeliveryAssignment, Inventory, AuditLog, CustomerProfile,
} = require('../models');
const {
  ORDER_STATUS, ORDER_PAYMENT_STATUS, VENDOR_STATUS, PRODUCT_STATUS,
  VERIFICATION_STATUS, REVIEW_STATUS, REFUND_STATUS, DELIVERY_PARTNER_STATUS,
  ACCOUNT_STATUS,
} = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { toDateOnly } = require('../utils/dates');
const money = require('../utils/money');
const { ok, paginated, fail } = require('../utils/response');

/**
 * Platform dashboards and the audit trail.
 *
 * Read-only. Every figure here is derived at query time rather than kept in a
 * counter, so a dashboard can never drift from the tables it describes — a
 * cached count that quietly diverges is worse than a slightly slower query.
 *
 * The action queue is the part that matters operationally: vendors, licences and
 * age verifications waiting on a human are what actually block trade, so they
 * are surfaced as counts an admin can act on rather than buried in list screens.
 */

const AUDIT_SORTABLE = ['id', 'action', 'entityType', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

/** Resolves the reporting window; defaults to the last 30 days. */
function resolveWindow(body) {
  const to = body.toDate ? new Date(body.toDate) : new Date();
  const from = body.fromDate
    ? new Date(body.fromDate)
    : new Date(to.getTime() - 30 * 24 * 3600 * 1000);

  return { from, to, where: { createdAt: { [Op.gte]: from, [Op.lte]: to } } };
}

/* -------------------------------------------------------------------------- */
/*                            PLATFORM DASHBOARD                              */
/* -------------------------------------------------------------------------- */
const dashboard = async (req, res) => {
  try {
    const { from, to, where: windowWhere } = resolveWindow(req.body);

    const [
      totalUsers, activeUsers, totalCustomers, verifiedCustomers,
      totalVendors, approvedVendors, pendingVendors,
      totalProducts, liveProducts, pendingProducts,
      totalOrders, windowOrders, ordersByStatus, revenueRow,
      pendingVerifications, pendingLicences, pendingReviews, openRefunds,
      activePartners, liveDeliveries, outOfStock,
    ] = await Promise.all([
      User.count(),
      User.count({ where: { accountStatus: ACCOUNT_STATUS.ACTIVE, isActive: true } }),
      CustomerProfile.count(),
      CustomerProfile.count({ where: { ageVerified: true } }),

      Vendor.count(),
      Vendor.count({ where: { status: VENDOR_STATUS.APPROVED } }),
      Vendor.count({ where: { status: VENDOR_STATUS.PENDING } }),

      Product.count(),
      Product.count({ where: { status: PRODUCT_STATUS.ACTIVE, isActive: true } }),
      Product.count({ where: { status: PRODUCT_STATUS.PENDING_APPROVAL } }),

      Order.count(),
      Order.count({ where: windowWhere }),
      Order.findAll({
        where: windowWhere,
        attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true,
      }),
      Order.findOne({
        where: { ...windowWhere, status: ORDER_STATUS.DELIVERED },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('grand_total')), 'revenue'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'delivered'],
        ],
        raw: true,
      }),

      AgeVerification.count({ where: { status: VERIFICATION_STATUS.PENDING } }),
      VendorLicense.count({ where: { status: VERIFICATION_STATUS.PENDING } }),
      Review.count({ where: { status: REVIEW_STATUS.PENDING } }),
      Refund.count({
        where: {
          status: {
            [Op.in]: [REFUND_STATUS.REQUESTED, REFUND_STATUS.APPROVED, REFUND_STATUS.PROCESSING],
          },
        },
      }),

      DeliveryPartner.count({ where: { status: DELIVERY_PARTNER_STATUS.ACTIVE } }),
      DeliveryAssignment.count({
        where: { status: { [Op.in]: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'IN_TRANSIT'] } },
      }),
      Inventory.count({ where: { quantityAvailable: 0 } }),
    ]);

    const byStatus = ordersByStatus.reduce((acc, row) => {
      acc[row.status] = Number(row.count);
      return acc;
    }, {});

    const revenue = money.round2(revenueRow?.revenue || 0);
    const delivered = Number(revenueRow?.delivered || 0);
    const cancelled = byStatus[ORDER_STATUS.CANCELLED] || 0;

    // Licences lapsing within 30 days: a store loses the right to sell the day
    // one expires, so this is a trading risk, not an admin chore.
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);

    const expiringLicences = await VendorLicense.count({
      where: {
        status: VERIFICATION_STATUS.APPROVED,
        validUntil: { [Op.lte]: toDateOnly(horizon), [Op.gte]: toDateOnly(new Date()) },
      },
    });

    return ok(
      res,
      {
        window: { from, to },
        users: {
          total: totalUsers,
          active: activeUsers,
          customers: totalCustomers,
          ageVerifiedCustomers: verifiedCustomers,
          verificationRate: totalCustomers
            ? Math.round((verifiedCustomers / totalCustomers) * 100)
            : 0,
        },
        vendors: { total: totalVendors, approved: approvedVendors, pending: pendingVendors },
        catalog: { total: totalProducts, live: liveProducts, awaitingApproval: pendingProducts },
        orders: {
          allTime: totalOrders,
          inWindow: windowOrders,
          delivered,
          byStatus,
          cancellationRate: windowOrders ? Math.round((cancelled / windowOrders) * 100) : 0,
        },
        revenue: {
          total: revenue,
          averageOrderValue: delivered ? money.round2(revenue / delivered) : 0,
        },
        delivery: { activePartners, liveDeliveries },
        inventory: { outOfStockSkus: outOfStock },
        // What is actually waiting on a human right now.
        actionQueue: {
          ageVerifications: pendingVerifications,
          vendorLicences: pendingLicences,
          vendorApplications: pendingVendors,
          productApprovals: pendingProducts,
          reviews: pendingReviews,
          refunds: openRefunds,
          expiringLicences,
        },
      },
      'Dashboard fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error building the dashboard', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              SALES REPORT                                  */
/* -------------------------------------------------------------------------- */
/** Revenue by day, by store and by product type over the window. */
const salesReport = async (req, res) => {
  try {
    const { from, to } = resolveWindow(req.body);

    const where = {
      createdAt: { [Op.gte]: from, [Op.lte]: to },
      status: ORDER_STATUS.DELIVERED,
    };
    if (req.body.vendorId) where.vendorId = req.body.vendorId;

    const [daily, byVendor, totals] = await Promise.all([
      Order.findAll({
        where,
        attributes: [
          [sequelize.fn('DATE', sequelize.col('created_at')), 'day'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'orders'],
          [sequelize.fn('SUM', sequelize.col('grand_total')), 'revenue'],
        ],
        group: [sequelize.fn('DATE', sequelize.col('created_at'))],
        order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']],
        raw: true,
      }),
      Order.findAll({
        where,
        attributes: [
          'vendorId',
          [sequelize.fn('COUNT', sequelize.col('Order.id')), 'orders'],
          [sequelize.fn('SUM', sequelize.col('grand_total')), 'revenue'],
        ],
        include: [{ model: Vendor, as: 'vendor', attributes: ['businessName'] }],
        group: ['Order.vendor_id', 'vendor.id'],
        raw: true,
        nest: true,
      }),
      Order.findOne({
        where,
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'orders'],
          [sequelize.fn('SUM', sequelize.col('grand_total')), 'revenue'],
          [sequelize.fn('SUM', sequelize.col('discount_total')), 'discounts'],
          [sequelize.fn('SUM', sequelize.col('tax_total')), 'tax'],
          [sequelize.fn('SUM', sequelize.col('delivery_fee')), 'deliveryFees'],
        ],
        raw: true,
      }),
    ]);

    const orders = Number(totals?.orders || 0);
    const revenue = money.round2(totals?.revenue || 0);

    return ok(
      res,
      {
        window: { from, to },
        totals: {
          orders,
          revenue,
          discounts: money.round2(totals?.discounts || 0),
          tax: money.round2(totals?.tax || 0),
          deliveryFees: money.round2(totals?.deliveryFees || 0),
          averageOrderValue: orders ? money.round2(revenue / orders) : 0,
        },
        daily: daily.map((d) => ({
          day: d.day,
          orders: Number(d.orders),
          revenue: money.round2(d.revenue),
        })),
        byVendor: byVendor.map((v) => ({
          vendorId: v.vendorId,
          businessName: v.vendor?.businessName || null,
          orders: Number(v.orders),
          revenue: money.round2(v.revenue),
        })),
      },
      'Sales report fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error building the sales report', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            COMPLIANCE REPORT                               */
/* -------------------------------------------------------------------------- */
/**
 * The report a regulator would ask for: who is verified, which licences are
 * valid, and whether every delivered order had its recipient checked at the door.
 */
const complianceReport = async (req, res) => {
  try {
    const { from, to } = resolveWindow(req.body);
    const today = toDateOnly(new Date());

    const [
      verificationsByStatus, licencesByStatus, expiredLicences,
      deliveredCount, verifiedHandoffs, ordersByRegion,
    ] = await Promise.all([
      AgeVerification.findAll({
        attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true,
      }),
      VendorLicense.findAll({
        attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['status'],
        raw: true,
      }),
      VendorLicense.count({
        where: { status: VERIFICATION_STATUS.APPROVED, validUntil: { [Op.lt]: today } },
      }),
      Order.count({
        where: {
          status: ORDER_STATUS.DELIVERED,
          deliveredAt: { [Op.gte]: from, [Op.lte]: to },
        },
      }),
      DeliveryAssignment.count({
        where: {
          status: 'DELIVERED',
          recipientVerified: true,
          deliveredAt: { [Op.gte]: from, [Op.lte]: to },
        },
        paranoid: false,
      }),
      Order.findAll({
        where: { createdAt: { [Op.gte]: from, [Op.lte]: to } },
        attributes: ['regionCode', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        group: ['regionCode'],
        raw: true,
      }),
    ]);

    const tally = (rows) => rows.reduce((acc, r) => {
      acc[r.status] = Number(r.count);
      return acc;
    }, {});

    return ok(
      res,
      {
        window: { from, to },
        ageVerification: tally(verificationsByStatus),
        vendorLicences: {
          ...tally(licencesByStatus),
          // An approved licence past its end date means a store is trading
          // without cover; it should always be zero.
          expiredButApproved: expiredLicences,
        },
        recipientVerification: {
          deliveredOrders: deliveredCount,
          verifiedAtHandover: verifiedHandoffs,
          // Should be 100. Anything less is a delivery that completed without
          // the age check, and needs investigating.
          coveragePercent: deliveredCount
            ? Math.round((verifiedHandoffs / deliveredCount) * 100)
            : 100,
        },
        ordersByRegion: ordersByRegion.map((r) => ({
          regionCode: r.regionCode || 'UNKNOWN',
          orders: Number(r.count),
        })),
      },
      'Compliance report fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error building the compliance report', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                               AUDIT LOG                                    */
/* -------------------------------------------------------------------------- */
const auditLogs = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: AUDIT_SORTABLE,
      defaultSort: 'createdAt',
    });

    const where = {};
    if (req.body.action) where.action = req.body.action;
    if (req.body.entityType) where.entityType = req.body.entityType;
    if (req.body.entityId) where.entityId = req.body.entityId;
    if (req.body.actorUserId) where.actorUserId = req.body.actorUserId;
    if (req.body.ipAddress) where.ipAddress = req.body.ipAddress;

    if (req.body.fromDate || req.body.toDate) {
      where.createdAt = {};
      if (req.body.fromDate) where.createdAt[Op.gte] = new Date(req.body.fromDate);
      if (req.body.toDate) where.createdAt[Op.lte] = new Date(req.body.toDate);
    }

    if (req.body.search) {
      where[Op.or] = [
        { action: { [Op.like]: `%${req.body.search}%` } },
        { entityType: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await AuditLog.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'actor',
        attributes: ['id', 'firstName', 'lastName', 'email'],
        required: false,
      }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        oldValues: log.oldValues,
        newValues: log.newValues,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
        actor: log.actor
          ? {
            id: log.actor.id,
            name: [log.actor.firstName, log.actor.lastName].filter(Boolean).join(' '),
            email: log.actor.email,
          }
          : { name: 'System' },
      })),
      toPageMeta(result, { page, limit }),
      'Audit logs fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching audit logs', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                         AUDIT TRAIL FOR ONE ENTITY                         */
/* -------------------------------------------------------------------------- */
/** Everything that ever happened to one record — the "who changed this?" view. */
const entityTrail = async (req, res) => {
  try {
    const logs = await AuditLog.findAll({
      where: { entityType: req.body.entityType, entityId: req.body.entityId },
      include: [{
        model: User,
        as: 'actor',
        attributes: ['id', 'firstName', 'lastName', 'email'],
        required: false,
      }],
      order: [['createdAt', 'ASC']],
      limit: 500,
    });

    return ok(
      res,
      logs.map((log) => ({
        id: log.id,
        action: log.action,
        oldValues: log.oldValues,
        newValues: log.newValues,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
        actor: log.actor
          ? {
            id: log.actor.id,
            name: [log.actor.firstName, log.actor.lastName].filter(Boolean).join(' '),
          }
          : { name: 'System' },
      })),
      'Audit trail fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching the audit trail', 500, [{ message: error.message }]);
  }
};

module.exports = { dashboard, salesReport, complianceReport, auditLogs, entityTrail };
