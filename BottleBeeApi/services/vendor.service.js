'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Vendor, VendorUser, VendorLicense, VendorAddress, User, Role, UserRole, Product, Order,
} = require('../models');
const {
  VENDOR_STATUS, VENDOR_ROLE, VERIFICATION_STATUS, ROLES, AUDIT_ACTIONS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const { toDateOnly } = require('../utils/dates');
const notificationService = require('./notification.service');
const complianceService = require('./compliance.service');

/**
 * Vendor (licensed store) onboarding and administration.
 *
 * Bottle Bee is a marketplace, not a seller: every product belongs to a vendor,
 * and a vendor may only transact while it is APPROVED *and* holds an APPROVED
 * licence that is valid today for the delivery region. `assertOperational` is
 * the gate checkout calls, and it is the only place that rule lives.
 */

const SORTABLE = ['id', 'businessName', 'status', 'ratingAvg', 'createdAt', 'reviewedAt'];

function serialize(vendor, extra = {}) {
  return {
    id: vendor.id,
    businessName: vendor.businessName,
    legalName: vendor.legalName,
    ownerUserId: vendor.ownerUserId,
    email: vendor.email,
    phone: vendor.phone,
    description: vendor.description,
    logoUrl: vendor.logoUrl,
    status: vendor.status,
    rejectionReason: vendor.rejectionReason,
    reviewedBy: vendor.reviewedBy,
    reviewedAt: vendor.reviewedAt,
    ratingAvg: Number(vendor.ratingAvg || 0),
    ratingCount: vendor.ratingCount,
    commissionPercent: Number(vendor.commissionPercent || 0),
    deliveryRadiusKm: vendor.deliveryRadiusKm === null ? null : Number(vendor.deliveryRadiusKm),
    minOrderAmount: vendor.minOrderAmount === null ? null : Number(vendor.minOrderAmount),
    isActive: vendor.isActive,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
    owner: vendor.owner
      ? {
        id: vendor.owner.id,
        firstName: vendor.owner.firstName,
        lastName: vendor.owner.lastName,
        email: vendor.owner.email,
        phone: vendor.owner.phone,
      }
      : undefined,
    ...extra,
  };
}

function serializeLicense(license) {
  return {
    id: license.id,
    vendorId: license.vendorId,
    licenseNumber: license.licenseNumber,
    licenseType: license.licenseType,
    issuingAuthority: license.issuingAuthority,
    regionCode: license.regionCode,
    validFrom: license.validFrom,
    validUntil: license.validUntil,
    documentUrl: license.documentUrl,
    status: license.status,
    rejectionReason: license.rejectionReason,
    reviewedBy: license.reviewedBy,
    reviewedAt: license.reviewedAt,
    isValidToday: typeof license.isValidToday === 'function' ? license.isValidToday() : undefined,
    isActive: license.isActive,
    createdAt: license.createdAt,
  };
}

function serializeAddress(address) {
  return {
    id: address.id,
    vendorId: address.vendorId,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    regionCode: address.regionCode,
    latitude: address.latitude === null ? null : Number(address.latitude),
    longitude: address.longitude === null ? null : Number(address.longitude),
    isPrimary: address.isPrimary,
    isActive: address.isActive,
  };
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/**
 * Confirms the caller may act on this vendor.
 *
 * Admins and support pass through. Everyone else must hold a vendor_users
 * membership, and `requireRoles` narrows that further (for example only an
 * OWNER may manage staff). Returns the membership, or null for staff access.
 */
async function assertVendorAccess(vendorId, req, { requireRoles = null } = {}) {
  if (req.user.isSuperAdmin || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT)) {
    return null;
  }

  const membership = await VendorUser.findOne({ where: { vendorId, userId: req.user.id } });
  if (!membership) {
    throw AppError.forbidden('You do not have access to this store');
  }

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
 * A staff member belonging to exactly one store need not send `vendorId`.
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
 * The gate checkout calls. Throws unless the vendor may legally sell into
 * `regionCode` right now.
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

// ---------------------------------------------------------------------------
// Application and profile
// ---------------------------------------------------------------------------

/**
 * Submits a store application. The applicant becomes the OWNER member and is
 * granted the VENDOR_OWNER role if they do not already hold it.
 */
async function apply(body, req) {
  const existing = await VendorUser.findOne({
    where: { userId: req.user.id, vendorRole: VENDOR_ROLE.OWNER },
    include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'status'] }],
  });

  if (existing?.vendor && existing.vendor.status !== VENDOR_STATUS.REJECTED) {
    throw AppError.conflict(
      `You already own ${existing.vendor.businessName} (status: ${existing.vendor.status}).`
    );
  }

  const vendor = await sequelize.transaction(async (transaction) => {
    const created = await Vendor.create(
      {
        businessName: body.businessName,
        legalName: body.legalName,
        ownerUserId: req.user.id,
        email: body.email,
        phone: body.phone,
        description: body.description || null,
        status: VENDOR_STATUS.PENDING,
        commissionPercent: body.commissionPercent ?? 0,
        deliveryRadiusKm: body.deliveryRadiusKm ?? null,
        minOrderAmount: body.minOrderAmount ?? null,
        createdBy: req.user.id,
      },
      { transaction }
    );

    await VendorUser.create(
      {
        vendorId: created.id,
        userId: req.user.id,
        vendorRole: VENDOR_ROLE.OWNER,
        createdBy: req.user.id,
      },
      { transaction }
    );

    if (body.address) {
      const regionCode = body.address.regionCode
        || await complianceService.resolveRegionCode({ state: body.address.state });

      await VendorAddress.create(
        {
          vendorId: created.id,
          ...body.address,
          regionCode,
          isPrimary: true,
          createdBy: req.user.id,
        },
        { transaction }
      );
    }

    // Grant VENDOR_OWNER so the applicant can manage the store once approved.
    const ownerRole = await Role.findOne({ where: { code: ROLES.VENDOR_OWNER }, transaction });
    if (ownerRole) {
      const held = await UserRole.findOne({
        where: { userId: req.user.id, roleId: ownerRole.id },
        transaction,
        paranoid: false,
      });
      if (held?.deletedAt) {
        await held.restore({ transaction });
      } else if (!held) {
        await UserRole.create(
          { userId: req.user.id, roleId: ownerRole.id, createdBy: req.user.id },
          { transaction }
        );
      }
    }

    return created;
  });

  await recordAudit({
    action: AUDIT_ACTIONS.VENDOR_APPLIED,
    entityType: 'Vendor',
    entityId: vendor.id,
    newValues: { businessName: vendor.businessName, legalName: vendor.legalName },
    req,
  });

  await notificationService.notify({
    userId: req.user.id,
    templateCode: 'VENDOR_APPLICATION_RECEIVED',
    title: 'Store application received',
    message: `We have received your application for ${vendor.businessName}. Upload your licence next — we review both together.`,
    referenceType: 'Vendor',
    referenceId: vendor.id,
  });

  return serialize(vendor);
}

async function update(body, req) {
  const vendorId = await resolveVendorId(body, req);
  await assertVendorAccess(vendorId, req, { requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER] });

  const vendor = await Vendor.findByPk(vendorId);
  if (!vendor) throw AppError.notFound('Store not found');

  const before = serialize(vendor);
  const isStaff = req.user.isSuperAdmin || req.user.roles.includes(ROLES.ADMIN);

  await vendor.update({
    businessName: body.businessName ?? vendor.businessName,
    legalName: body.legalName ?? vendor.legalName,
    email: body.email ?? vendor.email,
    phone: body.phone ?? vendor.phone,
    description: body.description ?? vendor.description,
    logoUrl: body.logoUrl ?? vendor.logoUrl,
    deliveryRadiusKm: body.deliveryRadiusKm ?? vendor.deliveryRadiusKm,
    minOrderAmount: body.minOrderAmount ?? vendor.minOrderAmount,
    // Commission is a commercial term set by the platform, never by the vendor.
    commissionPercent: isStaff && body.commissionPercent !== undefined
      ? body.commissionPercent
      : vendor.commissionPercent,
    isActive: body.isActive ?? vendor.isActive,
    updatedBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.VENDOR_APPLIED,
    entityType: 'Vendor',
    entityId: vendor.id,
    oldValues: before,
    newValues: serialize(vendor),
    req,
  });

  return detail({ id: vendor.id }, req);
}

async function list(body, req) {
  const { page, limit, offset, order } = buildPagination(body, { sortable: SORTABLE });

  const where = {};
  if (body.status) where.status = body.status;
  if (body.isActive !== undefined && body.isActive !== null) where.isActive = body.isActive;
  if (body.search) {
    where[Op.or] = [
      { businessName: { [Op.like]: `%${body.search}%` } },
      { legalName: { [Op.like]: `%${body.search}%` } },
      { email: { [Op.like]: `%${body.search}%` } },
      { phone: { [Op.like]: `%${body.search}%` } },
    ];
  }

  // A vendor user only ever sees their own stores.
  const isStaff = req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);

  if (!isStaff) {
    const ids = await myVendorIds(req);
    if (!ids.length) return { rows: [], meta: { page, limit, total: 0 } };
    where.id = { [Op.in]: ids };
  }

  const result = await Vendor.findAndCountAll({
    where,
    include: [{ model: User, as: 'owner', attributes: ['id', 'firstName', 'lastName', 'email', 'phone'] }],
    limit,
    offset,
    order,
    distinct: true,
  });

  return { rows: result.rows.map((v) => serialize(v)), meta: toPageMeta(result, { page, limit }) };
}

async function detail(body, req) {
  const vendor = await Vendor.findByPk(body.id, {
    include: [
      { model: User, as: 'owner', attributes: ['id', 'firstName', 'lastName', 'email', 'phone'] },
      { model: VendorLicense, as: 'licenses', required: false },
      { model: VendorAddress, as: 'addresses', required: false },
      {
        model: VendorUser,
        as: 'staff',
        required: false,
        include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email'] }],
      },
    ],
  });
  if (!vendor) throw AppError.notFound('Store not found');

  await assertVendorAccess(vendor.id, req);

  const [productCount, orderCount] = await Promise.all([
    Product.count({ where: { vendorId: vendor.id } }),
    Order.count({ where: { vendorId: vendor.id } }),
  ]);

  return serialize(vendor, {
    licenses: (vendor.licenses || []).map(serializeLicense),
    addresses: (vendor.addresses || []).map(serializeAddress),
    staff: (vendor.staff || []).map((s) => ({
      id: s.id,
      userId: s.userId,
      vendorRole: s.vendorRole,
      name: s.user ? [s.user.firstName, s.user.lastName].filter(Boolean).join(' ') : null,
      email: s.user?.email,
    })),
    stats: { productCount, orderCount },
  });
}

/** Stores the signed-in user belongs to, with their role in each. */
async function myVendors(req) {
  const memberships = await VendorUser.findAll({
    where: { userId: req.user.id },
    include: [{ model: Vendor, as: 'vendor' }],
  });

  return memberships
    .filter((m) => m.vendor)
    .map((m) => ({ ...serialize(m.vendor), vendorRole: m.vendorRole }));
}

/**
 * Approve, reject or suspend a store.
 * Approval is refused unless at least one licence has already been approved —
 * an approved store with no valid licence could otherwise appear operational.
 */
async function review(body, req) {
  const vendor = await Vendor.findByPk(body.id);
  if (!vendor) throw AppError.notFound('Store not found');

  const previous = vendor.status;
  if (previous === body.status) {
    throw AppError.businessRule(`This store is already ${body.status}`);
  }

  if (body.status === VENDOR_STATUS.APPROVED) {
    const approvedLicence = await VendorLicense.findOne({
      where: { vendorId: vendor.id, status: VERIFICATION_STATUS.APPROVED },
    });
    if (!approvedLicence) {
      throw AppError.businessRule(
        'Approve at least one licence for this store before approving the store itself.'
      );
    }
  }

  if ([VENDOR_STATUS.REJECTED, VENDOR_STATUS.SUSPENDED].includes(body.status) && !body.reason) {
    throw AppError.validation('A reason is required', [
      { field: 'reason', message: `Required when setting status to ${body.status}` },
    ]);
  }

  await vendor.update({
    status: body.status,
    rejectionReason: body.reason || null,
    reviewedBy: req.user.id,
    reviewedAt: new Date(),
    commissionPercent: body.commissionPercent ?? vendor.commissionPercent,
    updatedBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.VENDOR_REVIEWED,
    entityType: 'Vendor',
    entityId: vendor.id,
    oldValues: { status: previous },
    newValues: { status: body.status, reason: body.reason || null },
    req,
  });

  const messages = {
    [VENDOR_STATUS.APPROVED]: `${vendor.businessName} is approved. You can now publish products and accept orders.`,
    [VENDOR_STATUS.REJECTED]: `Your application for ${vendor.businessName} was not approved: ${body.reason}`,
    [VENDOR_STATUS.SUSPENDED]: `${vendor.businessName} has been suspended: ${body.reason}`,
    [VENDOR_STATUS.CLOSED]: `${vendor.businessName} has been closed.`,
    [VENDOR_STATUS.PENDING]: `${vendor.businessName} has been returned to pending review.`,
  };

  await notificationService.notify({
    userId: vendor.ownerUserId,
    templateCode: `VENDOR_${body.status}`,
    title: 'Store status updated',
    message: messages[body.status] || `Store status changed to ${body.status}.`,
    referenceType: 'Vendor',
    referenceId: vendor.id,
  });

  return detail({ id: vendor.id }, req);
}

// ---------------------------------------------------------------------------
// Licences
// ---------------------------------------------------------------------------

async function addLicense(body, files, req) {
  const vendorId = await resolveVendorId(body, req);
  await assertVendorAccess(vendorId, req, { requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER] });

  const clash = await VendorLicense.findOne({
    where: { licenseNumber: body.licenseNumber },
    paranoid: false,
    attributes: ['id', 'vendorId'],
  });
  if (clash) {
    throw AppError.conflict('This licence number is already registered on Bottle Bee');
  }

  const licence = await VendorLicense.create({
    vendorId,
    licenseNumber: body.licenseNumber,
    licenseType: body.licenseType,
    issuingAuthority: body.issuingAuthority,
    regionCode: body.regionCode,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
    documentUrl: files?.document || null,
    status: VERIFICATION_STATUS.PENDING,
    createdBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.VENDOR_LICENSE_REVIEWED,
    entityType: 'VendorLicense',
    entityId: licence.id,
    newValues: { vendorId, licenseNumber: body.licenseNumber, regionCode: body.regionCode },
    req,
  });

  return serializeLicense(licence);
}

async function listLicenses(body, req) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: ['id', 'status', 'validUntil', 'createdAt'],
  });

  const where = {};
  if (body.status) where.status = body.status;
  if (body.regionCode) where.regionCode = String(body.regionCode).toUpperCase();
  if (body.expiringSoon) {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    where.validUntil = { [Op.lte]: toDateOnly(horizon) };
    where.status = VERIFICATION_STATUS.APPROVED;
  }

  const isStaff = req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);

  if (body.vendorId) {
    await assertVendorAccess(body.vendorId, req);
    where.vendorId = body.vendorId;
  } else if (!isStaff) {
    const ids = await myVendorIds(req);
    if (!ids.length) return { rows: [], meta: { page, limit, total: 0 } };
    where.vendorId = { [Op.in]: ids };
  }

  const result = await VendorLicense.findAndCountAll({
    where,
    include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'status'] }],
    limit,
    offset,
    order,
    distinct: true,
  });

  return {
    rows: result.rows.map((l) => ({
      ...serializeLicense(l),
      vendor: l.vendor ? { id: l.vendor.id, businessName: l.vendor.businessName, status: l.vendor.status } : null,
    })),
    meta: toPageMeta(result, { page, limit }),
  };
}

async function reviewLicense(body, req) {
  const licence = await VendorLicense.findByPk(body.id, {
    include: [{ model: Vendor, as: 'vendor' }],
  });
  if (!licence) throw AppError.notFound('Licence not found');

  if (licence.status !== VERIFICATION_STATUS.PENDING) {
    throw AppError.businessRule(`This licence was already ${licence.status.toLowerCase()}`);
  }

  const approving = body.status === VERIFICATION_STATUS.APPROVED;
  if (!approving && !body.rejectionReason) {
    throw AppError.validation('A rejection reason is required', [
      { field: 'rejectionReason', message: 'Required when rejecting' },
    ]);
  }

  await licence.update({
    status: body.status,
    rejectionReason: approving ? null : body.rejectionReason,
    reviewedBy: req.user.id,
    reviewedAt: new Date(),
    updatedBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.VENDOR_LICENSE_REVIEWED,
    entityType: 'VendorLicense',
    entityId: licence.id,
    oldValues: { status: VERIFICATION_STATUS.PENDING },
    newValues: { status: body.status, rejectionReason: body.rejectionReason || null },
    req,
  });

  if (licence.vendor) {
    await notificationService.notify({
      userId: licence.vendor.ownerUserId,
      templateCode: approving ? 'VENDOR_LICENSE_APPROVED' : 'VENDOR_LICENSE_REJECTED',
      title: approving ? 'Licence approved' : 'Licence rejected',
      message: approving
        ? `Licence ${licence.licenseNumber} is approved for ${licence.regionCode}.`
        : `Licence ${licence.licenseNumber} was rejected: ${body.rejectionReason}`,
      referenceType: 'VendorLicense',
      referenceId: licence.id,
    });
  }

  return serializeLicense(licence);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

async function saveAddress(body, req) {
  const vendorId = await resolveVendorId(body, req);
  await assertVendorAccess(vendorId, req, { requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER] });

  const regionCode = body.regionCode
    || await complianceService.resolveRegionCode({ state: body.state });

  const address = await sequelize.transaction(async (transaction) => {
    const existing = body.id
      ? await VendorAddress.findOne({ where: { id: body.id, vendorId }, transaction })
      : null;

    if (body.id && !existing) throw AppError.notFound('Address not found');

    const makePrimary = body.isPrimary
      || (!existing && (await VendorAddress.count({ where: { vendorId }, transaction })) === 0);

    if (makePrimary) {
      await VendorAddress.update(
        { isPrimary: false, updatedBy: req.user.id },
        { where: { vendorId, isPrimary: true }, transaction }
      );
    }

    const values = {
      vendorId,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2 || null,
      city: body.city,
      state: body.state,
      postalCode: body.postalCode,
      country: body.country || 'India',
      regionCode,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      isPrimary: makePrimary,
    };

    if (existing) {
      await existing.update({ ...values, updatedBy: req.user.id }, { transaction });
      return existing;
    }

    return VendorAddress.create({ ...values, createdBy: req.user.id }, { transaction });
  });

  return serializeAddress(address);
}

async function listAddresses(body, req) {
  const vendorId = await resolveVendorId(body, req);
  const rows = await VendorAddress.findAll({
    where: { vendorId },
    order: [['isPrimary', 'DESC'], ['createdAt', 'DESC']],
  });
  return rows.map(serializeAddress);
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/**
 * Adds an existing user to a store. Only an OWNER may do this, and adding a
 * MANAGER also grants the VENDOR_MANAGER platform role so RBAC lines up.
 */
async function addStaff(body, req) {
  const vendorId = await resolveVendorId(body, req);
  await assertVendorAccess(vendorId, req, { requireRoles: [VENDOR_ROLE.OWNER] });

  const user = await User.findOne({ where: { email: String(body.email).toLowerCase() } });
  if (!user) {
    throw AppError.notFound('No Bottle Bee account exists for that email. Ask them to register first.');
  }

  if (body.vendorRole === VENDOR_ROLE.OWNER) {
    throw AppError.badRequest('Ownership transfer is not available here. Contact platform support.');
  }

  const membership = await sequelize.transaction(async (transaction) => {
    const existing = await VendorUser.findOne({
      where: { vendorId, userId: user.id },
      paranoid: false,
      transaction,
    });

    if (existing && !existing.deletedAt) {
      throw AppError.conflict('This user is already a member of the store');
    }

    let record;
    if (existing) {
      // The unique key survives a soft delete, so re-adding restores the row.
      await existing.restore({ transaction });
      await existing.update(
        { vendorRole: body.vendorRole, isActive: true, updatedBy: req.user.id },
        { transaction }
      );
      record = existing;
    } else {
      record = await VendorUser.create(
        { vendorId, userId: user.id, vendorRole: body.vendorRole, createdBy: req.user.id },
        { transaction }
      );
    }

    const roleCode = body.vendorRole === VENDOR_ROLE.MANAGER ? ROLES.VENDOR_MANAGER : null;
    if (roleCode) {
      const role = await Role.findOne({ where: { code: roleCode }, transaction });
      if (role) {
        const held = await UserRole.findOne({
          where: { userId: user.id, roleId: role.id },
          paranoid: false,
          transaction,
        });
        if (held?.deletedAt) {
          await held.restore({ transaction });
        } else if (!held) {
          await UserRole.create(
            { userId: user.id, roleId: role.id, createdBy: req.user.id },
            { transaction }
          );
        }
      }
    }

    return record;
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ROLES_ASSIGNED,
    entityType: 'VendorUser',
    entityId: membership.id,
    newValues: { vendorId, userId: user.id, vendorRole: body.vendorRole },
    req,
  });

  await notificationService.notify({
    userId: user.id,
    templateCode: 'VENDOR_STAFF_ADDED',
    title: 'Added to a store',
    message: `You have been added as ${body.vendorRole} to a Bottle Bee store.`,
    referenceType: 'Vendor',
    referenceId: vendorId,
  });

  return { id: membership.id, vendorId, userId: user.id, vendorRole: membership.vendorRole };
}

async function listStaff(body, req) {
  const vendorId = await resolveVendorId(body, req);
  const rows = await VendorUser.findAll({
    where: { vendorId },
    include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName', 'email', 'phone'] }],
    order: [['vendorRole', 'ASC']],
  });

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    vendorRole: r.vendorRole,
    name: r.user ? [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') : null,
    email: r.user?.email,
    phone: r.user?.phone,
    isActive: r.isActive,
    createdAt: r.createdAt,
  }));
}

async function removeStaff(body, req) {
  const membership = await VendorUser.findByPk(body.id);
  if (!membership) throw AppError.notFound('Staff membership not found');

  await assertVendorAccess(membership.vendorId, req, { requireRoles: [VENDOR_ROLE.OWNER] });

  if (membership.vendorRole === VENDOR_ROLE.OWNER) {
    throw AppError.forbidden('The store owner cannot be removed');
  }

  await membership.update({ deletedBy: req.user.id, isActive: false });
  await membership.destroy();

  await recordAudit({
    action: AUDIT_ACTIONS.ROLES_ASSIGNED,
    entityType: 'VendorUser',
    entityId: membership.id,
    oldValues: { vendorId: membership.vendorId, userId: membership.userId, vendorRole: membership.vendorRole },
    newValues: { removed: true },
    req,
  });

  return { removed: true };
}

module.exports = {
  apply,
  update,
  list,
  detail,
  myVendors,
  review,
  addLicense,
  listLicenses,
  reviewLicense,
  saveAddress,
  listAddresses,
  addStaff,
  listStaff,
  removeStaff,
  assertVendorAccess,
  assertOperational,
  resolveVendorId,
  myVendorIds,
  serialize,
  serializeLicense,
  serializeAddress,
};
