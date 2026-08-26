'use strict';

const { Op } = require('sequelize');

const {
  sequelize, CustomerProfile, CustomerAddress, User, Order,
} = require('../models');
const { ORDER_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');
const customerService = require('../services/customer.service');
const complianceService = require('../services/compliance.service');

/**
 * Customer profile and address book.
 *
 * Three rules are enforced here, each of which exists because getting it wrong
 * has a concrete consequence:
 *
 *  - Exactly one address is default per customer. Checkout falls back to the
 *    default when none is chosen, so two defaults would make the delivery
 *    destination ambiguous.
 *  - The governing compliance region is resolved and stored on the address at
 *    write time, so a later rule evaluation cannot shift because somebody
 *    retyped the state name.
 *  - Date of birth freezes once age verification is approved. It is the input to
 *    the legal age check, so letting a verified customer edit it would void the
 *    verification without anybody noticing.
 */

const ADDRESS_SORTABLE = ['id', 'label', 'city', 'isDefault', 'createdAt'];
const PROFILE_SORTABLE = ['id', 'legalFirstName', 'legalLastName', 'dateOfBirth', 'ageVerified', 'createdAt'];

const { serializeProfile, serializeAddress } = customerService;

/* ========================================================================== */
/*                                  PROFILE                                   */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                       CREATE OR UPDATE MY PROFILE                          */
/* -------------------------------------------------------------------------- */
const saveProfile = async (req, res) => {
  try {
    const { body } = req;
    const existing = await CustomerProfile.findOne({ where: { userId: req.user.id } });

    if (existing) {
      if (
        body.dateOfBirth
        && existing.ageVerified
        && String(body.dateOfBirth).slice(0, 10) !== String(existing.dateOfBirth).slice(0, 10)
      ) {
        return fail(
          res,
          'Your date of birth is locked because your identity has been verified. Contact support to correct it.',
          409
        );
      }

      const before = serializeProfile(existing);

      await existing.update({
        legalFirstName: body.legalFirstName ?? existing.legalFirstName,
        legalLastName: body.legalLastName ?? existing.legalLastName,
        dateOfBirth: body.dateOfBirth ?? existing.dateOfBirth,
        gender: body.gender ?? existing.gender,
        marketingOptIn: body.marketingOptIn ?? existing.marketingOptIn,
        updatedBy: req.user.id,
      });

      await recordAudit({
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'CustomerProfile',
        entityId: existing.id,
        oldValues: before,
        newValues: body,
        req,
      });

      const user = await User.findByPk(req.user.id);
      return ok(res, serializeProfile(existing, user), 'Profile saved successfully');
    }

    if (!body.dateOfBirth) {
      return fail(res, 'Date of birth is required to create a customer profile', 422, [
        { field: 'dateOfBirth', message: 'Required' },
      ]);
    }

    const profile = await CustomerProfile.create({
      userId: req.user.id,
      legalFirstName: body.legalFirstName,
      legalLastName: body.legalLastName,
      dateOfBirth: body.dateOfBirth,
      gender: body.gender || null,
      marketingOptIn: body.marketingOptIn ?? false,
      createdBy: req.user.id,
    });

    const user = await User.findByPk(req.user.id);
    return created(res, serializeProfile(profile, user), 'Profile saved successfully');
  } catch (error) {
    return fail(res, 'Error saving profile', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                    MY PROFILE PLUS MY ADDRESS BOOK                         */
/* -------------------------------------------------------------------------- */
const getProfile = async (req, res) => {
  try {
    const profile = await customerService.requireProfile(req.user.id);
    const user = await User.findByPk(req.user.id);

    const addresses = await CustomerAddress.findAll({
      where: { customerId: profile.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'DESC']],
    });

    return ok(
      res,
      { ...serializeProfile(profile, user), addresses: addresses.map(serializeAddress) },
      'Profile fetched successfully'
    );
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error fetching profile', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                      LIFETIME ORDER COUNTS AND SPEND                       */
/* -------------------------------------------------------------------------- */
const orderSummary = async (req, res) => {
  try {
    const profile = await customerService.requireProfile(req.user.id);

    const [total, delivered, cancelled, spent] = await Promise.all([
      Order.count({ where: { customerId: profile.id } }),
      Order.count({ where: { customerId: profile.id, status: ORDER_STATUS.DELIVERED } }),
      Order.count({ where: { customerId: profile.id, status: ORDER_STATUS.CANCELLED } }),
      Order.sum('grandTotal', {
        where: { customerId: profile.id, status: ORDER_STATUS.DELIVERED },
      }),
    ]);

    return ok(
      res,
      {
        totalOrders: total,
        deliveredOrders: delivered,
        cancelledOrders: cancelled,
        lifetimeSpend: Number(spent || 0),
      },
      'Order summary fetched successfully'
    );
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error fetching order summary', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                 ADDRESSES                                  */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                            LIST MY ADDRESSES                               */
/* -------------------------------------------------------------------------- */
const listAddresses = async (req, res) => {
  try {
    const profile = await customerService.requireProfile(req.user.id);

    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: ADDRESS_SORTABLE,
      defaultSort: 'createdAt',
    });

    const where = { customerId: profile.id };
    if (req.body.search) {
      where[Op.or] = [
        { label: { [Op.like]: `%${req.body.search}%` } },
        { addressLine1: { [Op.like]: `%${req.body.search}%` } },
        { city: { [Op.like]: `%${req.body.search}%` } },
        { postalCode: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await CustomerAddress.findAndCountAll({ where, limit, offset, order });

    return paginated(
      res,
      result.rows.map(serializeAddress),
      toPageMeta(result, { page, limit }),
      'Addresses fetched successfully'
    );
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error fetching addresses', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             ADD AN ADDRESS                                 */
/* -------------------------------------------------------------------------- */
const createAddress = async (req, res) => {
  try {
    const { body } = req;
    const profile = await customerService.requireProfile(req.user.id);

    // Store the governing region now, so rule evaluation later cannot drift.
    const regionCode = body.regionCode
      || await complianceService.resolveRegionCode({ state: body.state });

    const existingCount = await CustomerAddress.count({ where: { customerId: profile.id } });
    const shouldBeDefault = body.isDefault || existingCount === 0;

    const address = await sequelize.transaction(async (transaction) => {
      if (shouldBeDefault) {
        await CustomerAddress.update(
          { isDefault: false, updatedBy: req.user.id },
          { where: { customerId: profile.id, isDefault: true }, transaction }
        );
      }

      const record = await CustomerAddress.create(
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
        await profile.update(
          { defaultAddressId: record.id, updatedBy: req.user.id },
          { transaction }
        );
      }

      return record;
    });

    return created(res, serializeAddress(address), 'Address added successfully');
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error adding address', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            UPDATE AN ADDRESS                               */
/* -------------------------------------------------------------------------- */
const updateAddress = async (req, res) => {
  try {
    const { body } = req;
    const profile = await customerService.requireProfile(req.user.id);

    const address = await CustomerAddress.findOne({
      where: { id: body.id, customerId: profile.id },
    });
    if (!address) return fail(res, 'Address not found', 404);

    // Re-resolve the region only when the state actually changed.
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
        await profile.update(
          { defaultAddressId: address.id, updatedBy: req.user.id },
          { transaction }
        );
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

    return updated(res, serializeAddress(address), 'Address updated successfully');
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error updating address', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          SET THE DEFAULT ADDRESS                           */
/* -------------------------------------------------------------------------- */
const setDefaultAddress = async (req, res) => {
  try {
    const profile = await customerService.requireProfile(req.user.id);

    const address = await CustomerAddress.findOne({
      where: { id: req.body.id, customerId: profile.id },
    });
    if (!address) return fail(res, 'Address not found', 404);

    await sequelize.transaction(async (transaction) => {
      await CustomerAddress.update(
        { isDefault: false, updatedBy: req.user.id },
        { where: { customerId: profile.id, isDefault: true }, transaction }
      );
      await address.update({ isDefault: true, updatedBy: req.user.id }, { transaction });
      await profile.update({ defaultAddressId: address.id, updatedBy: req.user.id }, { transaction });
    });

    return updated(res, serializeAddress(address), 'Default address updated successfully');
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error setting default address', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            DELETE AN ADDRESS                               */
/* -------------------------------------------------------------------------- */
/**
 * Soft delete. The profile's default pointer is moved first so it can never
 * reference a deleted row, and historical orders keep their own address
 * snapshot regardless.
 */
const deleteAddress = async (req, res) => {
  try {
    const profile = await customerService.requireProfile(req.user.id);

    const address = await CustomerAddress.findOne({
      where: { id: req.body.id, customerId: profile.id },
    });
    if (!address) return fail(res, 'Address not found', 404);

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

      await address.update(
        { isDefault: false, isActive: false, deletedBy: req.user.id },
        { transaction }
      );
      await address.destroy({ transaction });
    });

    return deleted(res, 'Address deleted successfully');
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error deleting address', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                    CAN WE DELIVER TO THIS ADDRESS NOW?                     */
/* -------------------------------------------------------------------------- */
const checkServiceability = async (req, res) => {
  try {
    const profile = await customerService.requireProfile(req.user.id);

    const address = await CustomerAddress.findOne({
      where: { id: req.body.id, customerId: profile.id },
    });
    if (!address) return fail(res, 'Address not found', 404);

    const report = await complianceService.checkServiceability(address);

    return ok(res, { addressId: address.id, ...report }, 'Serviceability checked successfully');
  } catch (error) {
    if (error.statusCode === 404) return fail(res, error.message, 404);
    return fail(res, 'Error checking serviceability', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                              STAFF SURFACE                                 */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                          LIST CUSTOMERS (STAFF)                            */
/* -------------------------------------------------------------------------- */
const adminList = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: PROFILE_SORTABLE });

    const where = {};
    if (req.body.ageVerified !== undefined && req.body.ageVerified !== null) {
      where.ageVerified = req.body.ageVerified;
    }

    const userWhere = {};
    if (req.body.search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${req.body.search}%` } },
        { lastName: { [Op.like]: `%${req.body.search}%` } },
        { email: { [Op.like]: `%${req.body.search}%` } },
        { phone: { [Op.like]: `%${req.body.search}%` } },
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

    return paginated(
      res,
      result.rows.map((p) => serializeProfile(p, p.user)),
      toPageMeta(result, { page, limit }),
      'Customers fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching customers', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        GET ONE CUSTOMER (STAFF)                            */
/* -------------------------------------------------------------------------- */
const adminDetail = async (req, res) => {
  try {
    const profile = await CustomerProfile.findByPk(req.body.id, {
      include: [
        { model: User, as: 'user' },
        { model: CustomerAddress, as: 'addresses' },
      ],
    });
    if (!profile) return fail(res, 'Customer profile not found', 404);

    return ok(
      res,
      {
        ...serializeProfile(profile, profile.user),
        addresses: (profile.addresses || []).map(serializeAddress),
      },
      'Customer fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching customer', 500, [{ message: error.message }]);
  }
};

module.exports = {
  saveProfile,
  getProfile,
  orderSummary,
  listAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  checkServiceability,
  adminList,
  adminDetail,
};
