'use strict';

const { Op } = require('sequelize');

const { Vendor, VendorUser, VendorLicense } = require('../models');
const { VENDOR_STATUS, VERIFICATION_STATUS, ROLES } = require('../config/constants');
const AppError = require('../utils/AppError');
const { toDateOnly } = require('../utils/dates');

/**
 * Vendor access and licence guards — SHARED SERVICE.
 *
 * Bottle Bee is a marketplace, not a seller: the licensed store is always the
 * seller of record. Two questions therefore recur across the product,
 * inventory, cart, order, payment and delivery controllers:
 *
 *   "may this user act for this store?"        -> assertVendorAccess
 *   "may this store legally sell here, now?"   -> assertOperational
 *
 * Both live here because the answer must be identical everywhere. If checkout
 * and the storefront disagreed about whether a licence is valid, the platform
 * would show products it then refuses to sell — or worse, sell without a licence.
 *
 * Vendor profile, licence and staff administration lives in
 * `vendor.controller.js`.
 */

/**
 * Confirms the caller may act on this vendor.
 *
 * Admin, super admin and support pass through. Everyone else must hold a
 * `vendor_users` membership, and `requireRoles` narrows it further — only an
 * OWNER may manage staff, for instance.
 *
 * @returns {Promise<object|null>} the membership, or null for staff access
 */
async function assertVendorAccess(vendorId, req, { requireRoles = null } = {}) {
  if (
    req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT)
  ) {
    return null;
  }

  const membership = await VendorUser.findOne({ where: { vendorId, userId: req.user.id } });
  if (!membership) throw AppError.forbidden('You do not have access to this store');

  if (requireRoles && !requireRoles.includes(membership.vendorRole)) {
    throw AppError.forbidden(`This action requires one of: ${requireRoles.join(', ')}`);
  }

  return membership;
}

/** Vendor ids the caller belongs to. Used to scope vendor-side list endpoints. */
async function myVendorIds(req) {
  const memberships = await VendorUser.findAll({
    where: { userId: req.user.id },
    attributes: ['vendorId'],
  });
  return memberships.map((m) => Number(m.vendorId));
}

/**
 * Resolves which vendor a vendor-side request is acting for.
 * Staff belonging to exactly one store need not send `vendorId`; anyone in
 * several must say which, rather than have the platform guess.
 */
async function resolveVendorId(body, req) {
  if (body.vendorId) {
    await assertVendorAccess(body.vendorId, req);
    return Number(body.vendorId);
  }

  const ids = await myVendorIds(req);
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) throw AppError.forbidden('You are not associated with any store');

  throw AppError.badRequest('You belong to several stores — specify which one with vendorId', [
    { field: 'vendorId', vendorIds: ids },
  ]);
}

/**
 * The checkout gate. Throws unless the vendor may legally sell into `regionCode`
 * right now: APPROVED, active, and holding an APPROVED licence whose validity
 * window covers today for that region.
 */
async function assertOperational(vendorId, regionCode, { transaction = null } = {}) {
  const vendor = await Vendor.findByPk(vendorId, { transaction });
  if (!vendor) throw AppError.notFound('Store not found');

  if (vendor.status !== VENDOR_STATUS.APPROVED) {
    throw AppError.businessRule(
      `${vendor.businessName} is not currently accepting orders (status: ${vendor.status})`
    );
  }
  if (!vendor.isActive) {
    throw AppError.businessRule(`${vendor.businessName} is not currently accepting orders`);
  }

  const today = toDateOnly(new Date());

  const licence = await VendorLicense.findOne({
    where: {
      vendorId,
      status: VERIFICATION_STATUS.APPROVED,
      isActive: true,
      validFrom: { [Op.lte]: today },
      validUntil: { [Op.gte]: today },
      ...(regionCode ? { regionCode: String(regionCode).toUpperCase() } : {}),
    },
    transaction,
  });

  if (!licence) {
    throw AppError.compliance(
      regionCode
        ? `${vendor.businessName} does not hold a valid licence to deliver in ${regionCode}.`
        : `${vendor.businessName} does not hold a valid licence.`,
      [{ code: 'VENDOR_LICENCE_INVALID', vendorId: Number(vendorId), regionCode: regionCode || null }]
    );
  }

  return { vendor, licence };
}

/** True when the caller is platform staff rather than a vendor user. */
function isStaff(req) {
  return req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);
}

module.exports = {
  assertVendorAccess,
  myVendorIds,
  resolveVendorId,
  assertOperational,
  isStaff,
};
