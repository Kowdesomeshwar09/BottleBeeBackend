'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Vendor, VendorUser, VendorLicense, VendorAddress,
  User, Role, UserRole, Product, Order,
} = require('../models');
const {
  VENDOR_STATUS, VENDOR_ROLE, VERIFICATION_STATUS, ROLES, AUDIT_ACTIONS,
} = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const { toDateOnly } = require('../utils/dates');
const { publicUrl } = require('../middlewares/upload');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');
const vendorAccessService = require('../services/vendorAccess.service');
const complianceService = require('../services/compliance.service');
const notificationService = require('../services/notification.service');

/**
 * Vendor (licensed store) onboarding and administration.
 *
 * The rule that matters most here: a store cannot be APPROVED until at least one
 * of its licences is approved. Approving the store first would leave it looking
 * operational to the storefront while having no legal basis to sell — and since
 * Bottle Bee brokers rather than sells, that licence is the only thing making
 * the transaction lawful.
 *
 * Access and licence guards live in `services/vendorAccess.service.js` because
 * the product, inventory, cart, order and delivery controllers all apply them.
 */

const SORTABLE = ['id', 'businessName', 'status', 'ratingAvg', 'createdAt', 'reviewedAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serialize = (vendor, extra = {}) => ({
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
});

const serializeLicense = (license) => ({
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
});

const serializeAddress = (address) => ({
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
});

const OWNER_OR_MANAGER = [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER];

/**
 * Grants a platform role if the user does not already hold it, restoring a
 * soft-deleted grant rather than colliding with the unique key.
 */
async function ensurePlatformRole(userId, roleCode, actorId, transaction) {
  const role = await Role.findOne({ where: { code: roleCode }, transaction });
  if (!role) return;

  const held = await UserRole.findOne({
    where: { userId, roleId: role.id },
    paranoid: false,
    transaction,
  });

  if (held?.deletedAt) {
    await held.restore({ transaction });
  } else if (!held) {
    await UserRole.create({ userId, roleId: role.id, createdBy: actorId }, { transaction });
  }
}

/** Loads a vendor with everything the detail response needs. */
const findVendorWithRelations = (id) => Vendor.findByPk(id, {
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

/* -------------------------------------------------------------------------- */
/*                        SUBMIT A STORE APPLICATION                          */
/* -------------------------------------------------------------------------- */
const apply = async (req, res) => {
  try {
    const { body } = req;

    const existing = await VendorUser.findOne({
      where: { userId: req.user.id, vendorRole: VENDOR_ROLE.OWNER },
      include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'status'] }],
    });

    if (existing?.vendor && existing.vendor.status !== VENDOR_STATUS.REJECTED) {
      return fail(
        res,
        `You already own ${existing.vendor.businessName} (status: ${existing.vendor.status}).`,
        409
      );
    }

    const vendor = await sequelize.transaction(async (transaction) => {
      const record = await Vendor.create(
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
          vendorId: record.id,
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
            vendorId: record.id,
            ...body.address,
            regionCode,
            isPrimary: true,
            createdBy: req.user.id,
          },
          { transaction }
        );
      }

      await ensurePlatformRole(req.user.id, ROLES.VENDOR_OWNER, req.user.id, transaction);

      return record;
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

    return created(res, serialize(vendor), 'Store application submitted successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error submitting store application', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          UPDATE A STORE PROFILE                            */
/* -------------------------------------------------------------------------- */
const update = async (req, res) => {
  try {
    const vendorId = await vendorAccessService.resolveVendorId(req.body, req);
    await vendorAccessService.assertVendorAccess(vendorId, req, { requireRoles: OWNER_OR_MANAGER });

    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) return fail(res, 'Store not found', 404);

    const before = serialize(vendor);
    const staff = vendorAccessService.isStaff(req);

    await vendor.update({
      businessName: req.body.businessName ?? vendor.businessName,
      legalName: req.body.legalName ?? vendor.legalName,
      email: req.body.email ?? vendor.email,
      phone: req.body.phone ?? vendor.phone,
      description: req.body.description ?? vendor.description,
      logoUrl: req.body.logoUrl ?? vendor.logoUrl,
      deliveryRadiusKm: req.body.deliveryRadiusKm ?? vendor.deliveryRadiusKm,
      minOrderAmount: req.body.minOrderAmount ?? vendor.minOrderAmount,
      // Commission is a commercial term set by the platform, never by the vendor.
      commissionPercent: staff && req.body.commissionPercent !== undefined
        ? req.body.commissionPercent
        : vendor.commissionPercent,
      isActive: req.body.isActive ?? vendor.isActive,
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

    const fresh = await findVendorWithRelations(vendor.id);
    return updated(res, serialize(fresh), 'Store updated successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error updating store', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                               LIST STORES                                  */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.isActive !== undefined && req.body.isActive !== null) {
      where.isActive = req.body.isActive;
    }
    if (req.body.search) {
      where[Op.or] = [
        { businessName: { [Op.like]: `%${req.body.search}%` } },
        { legalName: { [Op.like]: `%${req.body.search}%` } },
        { email: { [Op.like]: `%${req.body.search}%` } },
        { phone: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    // A vendor user only ever sees their own stores.
    if (!vendorAccessService.isStaff(req)) {
      const ids = await vendorAccessService.myVendorIds(req);
      if (!ids.length) {
        return paginated(res, [], { page, limit, total: 0 }, 'Stores fetched successfully');
      }
      where.id = { [Op.in]: ids };
    }

    const result = await Vendor.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
      }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((v) => serialize(v)),
      toPageMeta(result, { page, limit }),
      'Stores fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching stores', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              GET ONE STORE                                 */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const vendor = await findVendorWithRelations(req.body.id);
    if (!vendor) return fail(res, 'Store not found', 404);

    await vendorAccessService.assertVendorAccess(vendor.id, req);

    const [productCount, orderCount] = await Promise.all([
      Product.count({ where: { vendorId: vendor.id } }),
      Order.count({ where: { vendorId: vendor.id } }),
    ]);

    return ok(
      res,
      serialize(vendor, {
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
      }),
      'Store fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching store', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            STORES I BELONG TO                              */
/* -------------------------------------------------------------------------- */
const myVendors = async (req, res) => {
  try {
    const memberships = await VendorUser.findAll({
      where: { userId: req.user.id },
      include: [{ model: Vendor, as: 'vendor' }],
    });

    const stores = memberships
      .filter((m) => m.vendor)
      .map((m) => ({ ...serialize(m.vendor), vendorRole: m.vendorRole }));

    return ok(res, stores, 'Your stores fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching your stores', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                    APPROVE, REJECT OR SUSPEND A STORE                      */
/* -------------------------------------------------------------------------- */
const review = async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.body.id);
    if (!vendor) return fail(res, 'Store not found', 404);

    const previous = vendor.status;
    if (previous === req.body.status) {
      return fail(res, `This store is already ${req.body.status}`, 409);
    }

    // Approving a store with no approved licence would make it look operational
    // with no legal basis to sell.
    if (req.body.status === VENDOR_STATUS.APPROVED) {
      const approvedLicence = await VendorLicense.findOne({
        where: { vendorId: vendor.id, status: VERIFICATION_STATUS.APPROVED },
      });
      if (!approvedLicence) {
        return fail(
          res,
          'Approve at least one licence for this store before approving the store itself.',
          409
        );
      }
    }

    if ([VENDOR_STATUS.REJECTED, VENDOR_STATUS.SUSPENDED].includes(req.body.status)
      && !req.body.reason) {
      return fail(res, 'A reason is required', 422, [
        { field: 'reason', message: `Required when setting status to ${req.body.status}` },
      ]);
    }

    await vendor.update({
      status: req.body.status,
      rejectionReason: req.body.reason || null,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      commissionPercent: req.body.commissionPercent ?? vendor.commissionPercent,
      updatedBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.VENDOR_REVIEWED,
      entityType: 'Vendor',
      entityId: vendor.id,
      oldValues: { status: previous },
      newValues: { status: req.body.status, reason: req.body.reason || null },
      req,
    });

    const messages = {
      [VENDOR_STATUS.APPROVED]: `${vendor.businessName} is approved. You can now publish products and accept orders.`,
      [VENDOR_STATUS.REJECTED]: `Your application for ${vendor.businessName} was not approved: ${req.body.reason}`,
      [VENDOR_STATUS.SUSPENDED]: `${vendor.businessName} has been suspended: ${req.body.reason}`,
      [VENDOR_STATUS.CLOSED]: `${vendor.businessName} has been closed.`,
      [VENDOR_STATUS.PENDING]: `${vendor.businessName} has been returned to pending review.`,
    };

    await notificationService.notify({
      userId: vendor.ownerUserId,
      templateCode: `VENDOR_${req.body.status}`,
      title: 'Store status updated',
      message: messages[req.body.status] || `Store status changed to ${req.body.status}.`,
      referenceType: 'Vendor',
      referenceId: vendor.id,
    });

    const fresh = await findVendorWithRelations(vendor.id);
    return updated(
      res,
      serialize(fresh, {
        licenses: (fresh.licenses || []).map(serializeLicense),
        addresses: (fresh.addresses || []).map(serializeAddress),
      }),
      `Store ${req.body.status.toLowerCase()} successfully`
    );
  } catch (error) {
    return fail(res, 'Error reviewing store', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                 LICENCES                                   */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                         UPLOAD AN EXCISE LICENCE                           */
/* -------------------------------------------------------------------------- */
const addLicense = async (req, res) => {
  try {
    const vendorId = await vendorAccessService.resolveVendorId(req.body, req);
    await vendorAccessService.assertVendorAccess(vendorId, req, { requireRoles: OWNER_OR_MANAGER });

    // Licence numbers are unique platform-wide: the same excise licence must not
    // be claimable by two stores.
    const clash = await VendorLicense.findOne({
      where: { licenseNumber: req.body.licenseNumber },
      paranoid: false,
      attributes: ['id'],
    });
    if (clash) return fail(res, 'This licence number is already registered on Bottle Bee', 409);

    const documentUrl = publicUrl(req.files?.document?.[0] || req.file);

    const licence = await VendorLicense.create({
      vendorId,
      licenseNumber: req.body.licenseNumber,
      licenseType: req.body.licenseType,
      issuingAuthority: req.body.issuingAuthority,
      regionCode: req.body.regionCode,
      validFrom: req.body.validFrom,
      validUntil: req.body.validUntil,
      documentUrl,
      status: VERIFICATION_STATUS.PENDING,
      createdBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.VENDOR_LICENSE_REVIEWED,
      entityType: 'VendorLicense',
      entityId: licence.id,
      newValues: {
        vendorId,
        licenseNumber: req.body.licenseNumber,
        regionCode: req.body.regionCode,
        action: 'SUBMITTED',
      },
      req,
    });

    return created(res, serializeLicense(licence), 'Licence submitted for review');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error submitting licence', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              LIST LICENCES                                 */
/* -------------------------------------------------------------------------- */
const listLicenses = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: ['id', 'status', 'validUntil', 'createdAt'],
    });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.regionCode) where.regionCode = String(req.body.regionCode).toUpperCase();

    // Approved licences lapsing within 30 days — the renewal worklist.
    if (req.body.expiringSoon) {
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);
      where.validUntil = { [Op.lte]: toDateOnly(horizon) };
      where.status = VERIFICATION_STATUS.APPROVED;
    }

    if (req.body.vendorId) {
      await vendorAccessService.assertVendorAccess(req.body.vendorId, req);
      where.vendorId = req.body.vendorId;
    } else if (!vendorAccessService.isStaff(req)) {
      const ids = await vendorAccessService.myVendorIds(req);
      if (!ids.length) {
        return paginated(res, [], { page, limit, total: 0 }, 'Licences fetched successfully');
      }
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

    return paginated(
      res,
      result.rows.map((l) => ({
        ...serializeLicense(l),
        vendor: l.vendor
          ? { id: l.vendor.id, businessName: l.vendor.businessName, status: l.vendor.status }
          : null,
      })),
      toPageMeta(result, { page, limit }),
      'Licences fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching licences', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       APPROVE OR REJECT A LICENCE                          */
/* -------------------------------------------------------------------------- */
const reviewLicense = async (req, res) => {
  try {
    const licence = await VendorLicense.findByPk(req.body.id, {
      include: [{ model: Vendor, as: 'vendor' }],
    });
    if (!licence) return fail(res, 'Licence not found', 404);

    if (licence.status !== VERIFICATION_STATUS.PENDING) {
      return fail(res, `This licence was already ${licence.status.toLowerCase()}`, 409);
    }

    const approving = req.body.status === VERIFICATION_STATUS.APPROVED;
    if (!approving && !req.body.rejectionReason) {
      return fail(res, 'A rejection reason is required', 422, [
        { field: 'rejectionReason', message: 'Required when rejecting' },
      ]);
    }

    await licence.update({
      status: req.body.status,
      rejectionReason: approving ? null : req.body.rejectionReason,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      updatedBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.VENDOR_LICENSE_REVIEWED,
      entityType: 'VendorLicense',
      entityId: licence.id,
      oldValues: { status: VERIFICATION_STATUS.PENDING },
      newValues: {
        status: req.body.status,
        rejectionReason: req.body.rejectionReason || null,
      },
      req,
    });

    if (licence.vendor) {
      await notificationService.notify({
        userId: licence.vendor.ownerUserId,
        templateCode: approving ? 'VENDOR_LICENSE_APPROVED' : 'VENDOR_LICENSE_REJECTED',
        title: approving ? 'Licence approved' : 'Licence rejected',
        message: approving
          ? `Licence ${licence.licenseNumber} is approved for ${licence.regionCode}.`
          : `Licence ${licence.licenseNumber} was rejected: ${req.body.rejectionReason}`,
        referenceType: 'VendorLicense',
        referenceId: licence.id,
      });
    }

    return updated(
      res,
      serializeLicense(licence),
      `Licence ${req.body.status.toLowerCase()} successfully`
    );
  } catch (error) {
    return fail(res, 'Error reviewing licence', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                              STORE ADDRESSES                               */
/* ========================================================================== */

const saveAddress = async (req, res) => {
  try {
    const vendorId = await vendorAccessService.resolveVendorId(req.body, req);
    await vendorAccessService.assertVendorAccess(vendorId, req, { requireRoles: OWNER_OR_MANAGER });

    const regionCode = req.body.regionCode
      || await complianceService.resolveRegionCode({ state: req.body.state });

    const address = await sequelize.transaction(async (transaction) => {
      const existing = req.body.id
        ? await VendorAddress.findOne({ where: { id: req.body.id, vendorId }, transaction })
        : null;

      if (req.body.id && !existing) {
        const err = new Error('Address not found');
        err.statusCode = 404;
        throw err;
      }

      const makePrimary = req.body.isPrimary
        || (!existing && (await VendorAddress.count({ where: { vendorId }, transaction })) === 0);

      if (makePrimary) {
        await VendorAddress.update(
          { isPrimary: false, updatedBy: req.user.id },
          { where: { vendorId, isPrimary: true }, transaction }
        );
      }

      const values = {
        vendorId,
        addressLine1: req.body.addressLine1,
        addressLine2: req.body.addressLine2 || null,
        city: req.body.city,
        state: req.body.state,
        postalCode: req.body.postalCode,
        country: req.body.country || 'India',
        regionCode,
        latitude: req.body.latitude ?? null,
        longitude: req.body.longitude ?? null,
        isPrimary: makePrimary,
      };

      if (existing) {
        await existing.update({ ...values, updatedBy: req.user.id }, { transaction });
        return existing;
      }

      return VendorAddress.create({ ...values, createdBy: req.user.id }, { transaction });
    });

    return updated(res, serializeAddress(address), 'Store address saved successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error saving store address', 500, [{ message: error.message }]);
  }
};

const listAddresses = async (req, res) => {
  try {
    const vendorId = await vendorAccessService.resolveVendorId(req.body, req);

    const rows = await VendorAddress.findAll({
      where: { vendorId },
      order: [['isPrimary', 'DESC'], ['createdAt', 'DESC']],
    });

    return ok(res, rows.map(serializeAddress), 'Store addresses fetched successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching store addresses', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                STORE STAFF                                 */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                        ADD A MANAGER OR STAFF MEMBER                       */
/* -------------------------------------------------------------------------- */
const addStaff = async (req, res) => {
  try {
    const vendorId = await vendorAccessService.resolveVendorId(req.body, req);
    await vendorAccessService.assertVendorAccess(vendorId, req, {
      requireRoles: [VENDOR_ROLE.OWNER],
    });

    const user = await User.findOne({ where: { email: String(req.body.email).toLowerCase() } });
    if (!user) {
      return fail(
        res,
        'No Bottle Bee account exists for that email. Ask them to register first.',
        404
      );
    }

    if (req.body.vendorRole === VENDOR_ROLE.OWNER) {
      return fail(res, 'Ownership transfer is not available here. Contact platform support.', 400);
    }

    const membership = await sequelize.transaction(async (transaction) => {
      const existing = await VendorUser.findOne({
        where: { vendorId, userId: user.id },
        paranoid: false,
        transaction,
      });

      if (existing && !existing.deletedAt) {
        const err = new Error('This user is already a member of the store');
        err.statusCode = 409;
        throw err;
      }

      let record;
      if (existing) {
        // The unique key survives a soft delete, so re-adding restores the row.
        await existing.restore({ transaction });
        await existing.update(
          { vendorRole: req.body.vendorRole, isActive: true, updatedBy: req.user.id },
          { transaction }
        );
        record = existing;
      } else {
        record = await VendorUser.create(
          {
            vendorId,
            userId: user.id,
            vendorRole: req.body.vendorRole,
            createdBy: req.user.id,
          },
          { transaction }
        );
      }

      // A MANAGER also needs the platform role, or RBAC would deny them the
      // endpoints their store role implies.
      if (req.body.vendorRole === VENDOR_ROLE.MANAGER) {
        await ensurePlatformRole(user.id, ROLES.VENDOR_MANAGER, req.user.id, transaction);
      }

      return record;
    });

    await recordAudit({
      action: AUDIT_ACTIONS.ROLES_ASSIGNED,
      entityType: 'VendorUser',
      entityId: membership.id,
      newValues: { vendorId, userId: user.id, vendorRole: req.body.vendorRole },
      req,
    });

    await notificationService.notify({
      userId: user.id,
      templateCode: 'VENDOR_STAFF_ADDED',
      title: 'Added to a store',
      message: `You have been added as ${req.body.vendorRole} to a Bottle Bee store.`,
      referenceType: 'Vendor',
      referenceId: vendorId,
    });

    return created(
      res,
      {
        id: membership.id, vendorId, userId: user.id, vendorRole: membership.vendorRole,
      },
      'Staff member added successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error adding staff member', 500, [{ message: error.message }]);
  }
};

const listStaff = async (req, res) => {
  try {
    const vendorId = await vendorAccessService.resolveVendorId(req.body, req);

    const rows = await VendorUser.findAll({
      where: { vendorId },
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
      }],
      order: [['vendorRole', 'ASC']],
    });

    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        vendorRole: r.vendorRole,
        name: r.user ? [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') : null,
        email: r.user?.email,
        phone: r.user?.phone,
        isActive: r.isActive,
        createdAt: r.createdAt,
      })),
      'Staff fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching staff', 500, [{ message: error.message }]);
  }
};

const removeStaff = async (req, res) => {
  try {
    const membership = await VendorUser.findByPk(req.body.id);
    if (!membership) return fail(res, 'Staff membership not found', 404);

    await vendorAccessService.assertVendorAccess(membership.vendorId, req, {
      requireRoles: [VENDOR_ROLE.OWNER],
    });

    if (membership.vendorRole === VENDOR_ROLE.OWNER) {
      return fail(res, 'The store owner cannot be removed', 403);
    }

    await membership.update({ deletedBy: req.user.id, isActive: false });
    await membership.destroy();

    await recordAudit({
      action: AUDIT_ACTIONS.ROLES_ASSIGNED,
      entityType: 'VendorUser',
      entityId: membership.id,
      oldValues: {
        vendorId: membership.vendorId,
        userId: membership.userId,
        vendorRole: membership.vendorRole,
      },
      newValues: { removed: true },
      req,
    });

    return deleted(res, 'Staff member removed successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error removing staff member', 500, [{ message: error.message }]);
  }
};

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
  serialize,
  serializeLicense,
  serializeAddress,
};
