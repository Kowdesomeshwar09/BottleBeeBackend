'use strict';

const { Op } = require('sequelize');

const {
  sequelize, CustomerProfile, CustomerAddress, User, Order,
} = require('../models');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const { AUDIT_ACTIONS } = require('../config/constants');
const complianceService = require('./compliance.service');

/**
 * Customer profile and address book.
 *
 * Address rules enforced here:
 *  - exactly one default address per customer,
 *  - the region code is resolved and stored so compliance evaluation is stable,
 *  - an address referenced by an order is never hard-deleted, and the profile's
 *    default pointer is moved before a soft delete so it cannot dangle.
 */

const ADDRESS_SORTABLE = ['id', 'label', 'city', 'isDefault', 'createdAt'];

/** The signed-in user's customer profile, created on demand if missing. */
async function requireProfile(userId, { transaction = null } = {}) {
  const profile = await CustomerProfile.findOne({ where: { userId }, transaction });
  if (!profile) {
    throw AppError.notFound(
      'No customer profile exists for this account. Create one via /customers/profile/save first.'
    );
  }
  return profile;
}

function serializeProfile(profile, user = null) {
  return {
    id: profile.id,
    userId: profile.userId,
    legalFirstName: profile.legalFirstName,
    legalLastName: profile.legalLastName,
    dateOfBirth: profile.dateOfBirth,
    gender: profile.gender,
    defaultAddressId: profile.defaultAddressId,
    marketingOptIn: profile.marketingOptIn,
    ageVerified: profile.ageVerified,
    ageVerifiedAt: profile.ageVerifiedAt,
    isActive: profile.isActive,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    user: user
      ? { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone }
      : undefined,
  };
}

function serializeAddress(address) {
  return {
    id: address.id,
    customerId: address.customerId,
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    regionCode: address.regionCode,
    latitude: address.latitude === null ? null : Number(address.latitude),
    longitude: address.longitude === null ? null : Number(address.longitude),
    isDefault: address.isDefault,
    deliveryInstructions: address.deliveryInstructions,
    isActive: address.isActive,
    createdAt: address.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Creates or updates the signed-in customer's profile. */
async function saveProfile(body, req) {
  const existing = await CustomerProfile.findOne({ where: { userId: req.user.id } });

  const profile = await sequelize.transaction(async (transaction) => {
    if (existing) {
      const before = serializeProfile(existing);

      // Date of birth drives age eligibility. Once an age verification has been
      // approved it is frozen — changing it would invalidate the approved check.
      if (body.dateOfBirth && existing.ageVerified
        && String(body.dateOfBirth).slice(0, 10) !== String(existing.dateOfBirth).slice(0, 10)) {
        throw AppError.businessRule(
          'Your date of birth is locked because your identity has been verified. Contact support to correct it.'
        );
      }

      await existing.update(
        {
          legalFirstName: body.legalFirstName ?? existing.legalFirstName,
          legalLastName: body.legalLastName ?? existing.legalLastName,
          dateOfBirth: body.dateOfBirth ?? existing.dateOfBirth,
          gender: body.gender ?? existing.gender,
          marketingOptIn: body.marketingOptIn ?? existing.marketingOptIn,
          updatedBy: req.user.id,
        },
        { transaction }
      );

      await recordAudit({
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'CustomerProfile',
        entityId: existing.id,
        oldValues: before,
        newValues: body,
        req,
        transaction,
      });

      return existing;
    }

    if (!body.dateOfBirth) {
      throw AppError.validation('Date of birth is required to create a customer profile', [
        { field: 'dateOfBirth', message: 'Required' },
      ]);
    }

    return CustomerProfile.create(
      {
        userId: req.user.id,
        legalFirstName: body.legalFirstName,
        legalLastName: body.legalLastName,
        dateOfBirth: body.dateOfBirth,
        gender: body.gender || null,
        marketingOptIn: body.marketingOptIn ?? false,
        createdBy: req.user.id,
      },
      { transaction }
    );
  });

  const user = await User.findByPk(req.user.id);
  return serializeProfile(profile, user);
}

/** The signed-in customer's profile plus their address book. */
async function getProfile(req) {
  const profile = await requireProfile(req.user.id);
  const user = await User.findByPk(req.user.id);
  const addresses = await CustomerAddress.findAll({
    where: { customerId: profile.id },
    order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
  });

  return {
    ...serializeProfile(profile, user),
    addresses: addresses.map(serializeAddress),
  };
}

/** Admin view of any customer. */
async function adminGetProfile(body) {
  const profile = await CustomerProfile.findByPk(body.id, {
    include: [{ model: User, as: 'user' }, { model: CustomerAddress, as: 'addresses' }],
  });
  if (!profile) throw AppError.notFound('Customer profile not found');

  return {
    ...serializeProfile(profile, profile.user),
    addresses: (profile.addresses || []).map(serializeAddress),
  };
}

async function adminList(body) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: ['id', 'legalFirstName', 'legalLastName', 'dateOfBirth', 'ageVerified', 'createdAt'],
  });

  const where = {};
  if (body.ageVerified !== undefined && body.ageVerified !== null) where.ageVerified = body.ageVerified;

  const userWhere = {};
  if (body.search) {
    userWhere[Op.or] = [
      { firstName: { [Op.like]: `%${body.search}%` } },
      { lastName: { [Op.like]: `%${body.search}%` } },
      { email: { [Op.like]: `%${body.search}%` } },
      { phone: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const result = await CustomerProfile.findAndCountAll({
    where,
    include: [{
      model: User,
      as: 'user',
      required: true,
      ...(Object.keys(userWhere).length ? { where: userWhere } : {}),
    }],
    limit,
    offset,
    order,
    distinct: true,
  });

  return {
    rows: result.rows.map((p) => serializeProfile(p, p.user)),
    meta: toPageMeta(result, { page, limit }),
  };
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

async function listAddresses(body, req) {
  const profile = await requireProfile(req.user.id);
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: ADDRESS_SORTABLE,
    defaultSort: 'createdAt',
  });

  const where = { customerId: profile.id };
  if (body.search) {
    where[Op.or] = [
      { label: { [Op.like]: `%${body.search}%` } },
      { addressLine1: { [Op.like]: `%${body.search}%` } },
      { city: { [Op.like]: `%${body.search}%` } },
      { postalCode: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const result = await CustomerAddress.findAndCountAll({ where, limit, offset, order });
  return { rows: result.rows.map(serializeAddress), meta: toPageMeta(result, { page, limit }) };
}

async function createAddress(body, req) {
  const profile = await requireProfile(req.user.id);

  // Resolve and store the governing region so compliance evaluation does not
  // depend on re-deriving it later from a possibly edited state name.
  const regionCode = body.regionCode
    || await complianceService.resolveRegionCode({ state: body.state, regionCode: body.regionCode });

  const existingCount = await CustomerAddress.count({ where: { customerId: profile.id } });
  const shouldBeDefault = body.isDefault || existingCount === 0;

  const address = await sequelize.transaction(async (transaction) => {
    if (shouldBeDefault) {
      await CustomerAddress.update(
        { isDefault: false, updatedBy: req.user.id },
        { where: { customerId: profile.id, isDefault: true }, transaction }
      );
    }

    const created = await CustomerAddress.create(
      {
        customerId: profile.id,
        label: body.label || null,
        recipientName: body.recipientName,
        phone: body.phone,
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2 || null,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        country: body.country || 'India',
        regionCode,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        isDefault: shouldBeDefault,
        deliveryInstructions: body.deliveryInstructions || null,
        createdBy: req.user.id,
      },
      { transaction }
    );

    if (shouldBeDefault) {
      await profile.update({ defaultAddressId: created.id, updatedBy: req.user.id }, { transaction });
    }

    return created;
  });

  return serializeAddress(address);
}

async function updateAddress(body, req) {
  const profile = await requireProfile(req.user.id);
  const address = await CustomerAddress.findOne({ where: { id: body.id, customerId: profile.id } });
  if (!address) throw AppError.notFound('Address not found');

  const regionCode = body.regionCode
    ?? (body.state && body.state !== address.state
      ? await complianceService.resolveRegionCode({ state: body.state })
      : address.regionCode);

  await sequelize.transaction(async (transaction) => {
    if (body.isDefault === true && !address.isDefault) {
      await CustomerAddress.update(
        { isDefault: false, updatedBy: req.user.id },
        { where: { customerId: profile.id, isDefault: true }, transaction }
      );
      await profile.update({ defaultAddressId: address.id, updatedBy: req.user.id }, { transaction });
    }

    await address.update(
      {
        label: body.label ?? address.label,
        recipientName: body.recipientName ?? address.recipientName,
        phone: body.phone ?? address.phone,
        addressLine1: body.addressLine1 ?? address.addressLine1,
        addressLine2: body.addressLine2 ?? address.addressLine2,
        city: body.city ?? address.city,
        state: body.state ?? address.state,
        postalCode: body.postalCode ?? address.postalCode,
        country: body.country ?? address.country,
        regionCode,
        latitude: body.latitude ?? address.latitude,
        longitude: body.longitude ?? address.longitude,
        isDefault: body.isDefault ?? address.isDefault,
        deliveryInstructions: body.deliveryInstructions ?? address.deliveryInstructions,
        updatedBy: req.user.id,
      },
      { transaction }
    );
  });

  return serializeAddress(address);
}

async function setDefaultAddress(body, req) {
  const profile = await requireProfile(req.user.id);
  const address = await CustomerAddress.findOne({ where: { id: body.id, customerId: profile.id } });
  if (!address) throw AppError.notFound('Address not found');

  await sequelize.transaction(async (transaction) => {
    await CustomerAddress.update(
      { isDefault: false, updatedBy: req.user.id },
      { where: { customerId: profile.id, isDefault: true }, transaction }
    );
    await address.update({ isDefault: true, updatedBy: req.user.id }, { transaction });
    await profile.update({ defaultAddressId: address.id, updatedBy: req.user.id }, { transaction });
  });

  return serializeAddress(address);
}

/**
 * Soft deletes an address. The default pointer is moved first so it can never
 * reference a deleted row, and an address already used by an order is kept.
 */
async function deleteAddress(body, req) {
  const profile = await requireProfile(req.user.id);
  const address = await CustomerAddress.findOne({ where: { id: body.id, customerId: profile.id } });
  if (!address) throw AppError.notFound('Address not found');

  await sequelize.transaction(async (transaction) => {
    if (Number(profile.defaultAddressId) === Number(address.id)) {
      const replacement = await CustomerAddress.findOne({
        where: { customerId: profile.id, id: { [Op.ne]: address.id } },
        order: [['createdAt', 'DESC']],
        transaction,
      });

      await profile.update(
        { defaultAddressId: replacement ? replacement.id : null, updatedBy: req.user.id },
        { transaction }
      );

      if (replacement) {
        await replacement.update({ isDefault: true, updatedBy: req.user.id }, { transaction });
      }
    }

    await address.update({ isDefault: false, isActive: false, deletedBy: req.user.id }, { transaction });
    await address.destroy({ transaction });
  });

  return { deleted: true };
}

/** Serviceability preview for one of the customer's addresses. */
async function checkAddressServiceability(body, req) {
  const profile = await requireProfile(req.user.id);
  const address = await CustomerAddress.findOne({ where: { id: body.id, customerId: profile.id } });
  if (!address) throw AppError.notFound('Address not found');

  const report = await complianceService.checkServiceability(address);
  return { addressId: address.id, ...report };
}

/** Lifetime order summary, shown on the customer dashboard. */
async function orderSummary(req) {
  const profile = await requireProfile(req.user.id);

  const [total, delivered, cancelled] = await Promise.all([
    Order.count({ where: { customerId: profile.id } }),
    Order.count({ where: { customerId: profile.id, status: 'DELIVERED' } }),
    Order.count({ where: { customerId: profile.id, status: 'CANCELLED' } }),
  ]);

  const spent = await Order.sum('grandTotal', {
    where: { customerId: profile.id, status: 'DELIVERED' },
  });

  return {
    totalOrders: total,
    deliveredOrders: delivered,
    cancelledOrders: cancelled,
    lifetimeSpend: Number(spent || 0),
  };
}

module.exports = {
  requireProfile,
  saveProfile,
  getProfile,
  adminGetProfile,
  adminList,
  listAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  checkAddressServiceability,
  orderSummary,
  serializeProfile,
  serializeAddress,
};
