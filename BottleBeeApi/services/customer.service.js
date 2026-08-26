'use strict';

const { CustomerProfile } = require('../models');
const AppError = require('../utils/AppError');

/**
 * Customer profile lookup — SHARED SERVICE.
 *
 * Small on purpose. Profile and address management lives in
 * `customer.controller.js`; what stays here is the one question the cart, order
 * and payment controllers all have to ask first — "who is this customer, and do
 * they have a profile at all?" — plus the address serializer the order
 * controller reuses when snapshotting a delivery address.
 *
 * `orders.customer_id` and `carts.customer_id` reference `customer_profiles`,
 * not `users`, so every purchase path must resolve the profile before it can do
 * anything. Duplicating that lookup would mean duplicating the error message a
 * customer sees when their profile is missing.
 */

/**
 * Resolves the customer profile for a user id, or throws 404.
 * @param {number} userId
 * @param {object} [options]
 * @param {object} [options.transaction] join the caller's transaction
 */
async function requireProfile(userId, { transaction = null } = {}) {
  const profile = await CustomerProfile.findOne({ where: { userId }, transaction });

  if (!profile) {
    throw AppError.notFound(
      'No customer profile exists for this account. Create one via /customers/profile/save first.'
    );
  }

  return profile;
}

/** Profile shape shared by the customer, order and auth surfaces. */
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
      ? {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
      }
      : undefined,
  };
}

/** Address shape shared by the customer and order surfaces. */
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

module.exports = { requireProfile, serializeProfile, serializeAddress };
