'use strict';

const {
  ORDER_STATUS,
  ORDER_TRANSITIONS,
  DELIVERY_ASSIGNMENT_STATUS,
  DELIVERY_TRANSITIONS,
  ORDER_TERMINAL_STATUSES,
  ORDER_STATUSES_HOLDING_RESERVATION,
  CUSTOMER_CANCELLABLE_STATUSES,
  ROLES,
} = require('../config/constants');
const AppError = require('./AppError');

/**
 * The order lifecycle is enforced here and nowhere else. Services must call
 * assertOrderTransition before writing a new status so an illegal jump (for
 * example PLACED -> DELIVERED) is impossible regardless of which endpoint or
 * role attempted it.
 */

/** Which roles may drive a given transition. */
const TRANSITION_ACTORS = {
  [ORDER_STATUS.PAYMENT_PENDING]: [ROLES.CUSTOMER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.PAYMENT_FAILED]: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.CONFIRMED]: [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.VENDOR_OWNER, ROLES.VENDOR_MANAGER],
  [ORDER_STATUS.PREPARING]: [ROLES.VENDOR_OWNER, ROLES.VENDOR_MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.READY_FOR_PICKUP]: [ROLES.VENDOR_OWNER, ROLES.VENDOR_MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.ASSIGNED]: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.PICKED_UP]: [ROLES.DELIVERY_PARTNER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ROLES.DELIVERY_PARTNER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.DELIVERED]: [ROLES.DELIVERY_PARTNER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  [ORDER_STATUS.CANCELLED]: [
    ROLES.CUSTOMER, ROLES.VENDOR_OWNER, ROLES.VENDOR_MANAGER,
    ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.SUPPORT_AGENT,
  ],
  [ORDER_STATUS.REFUNDED]: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
};

function isValidOrderTransition(from, to) {
  const allowed = ORDER_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function allowedNextOrderStatuses(from) {
  return ORDER_TRANSITIONS[from] || [];
}

/**
 * Throws unless the transition is permitted by the graph and by the actor's
 * roles. Pass `roles` as the array of role codes held by the acting user.
 */
function assertOrderTransition(from, to, roles = []) {
  if (from === to) {
    throw AppError.businessRule(`Order is already in status ${to}`);
  }

  if (!isValidOrderTransition(from, to)) {
    throw AppError.businessRule(
      `Illegal order transition ${from} -> ${to}`,
      [{ field: 'status', allowed: allowedNextOrderStatuses(from) }]
    );
  }

  const actors = TRANSITION_ACTORS[to];
  if (actors && !roles.some((role) => actors.includes(role))) {
    throw AppError.forbidden(`Your role may not move an order to ${to}`);
  }

  return true;
}

/** A customer may only self-cancel before the vendor has begun preparing. */
function assertCustomerMayCancel(status) {
  if (!CUSTOMER_CANCELLABLE_STATUSES.includes(status)) {
    throw AppError.businessRule(
      `An order in status ${status} can no longer be cancelled by the customer. Please contact support.`
    );
  }
  return true;
}

function isTerminal(status) {
  return ORDER_TERMINAL_STATUSES.includes(status);
}

/** True when the order still holds reserved inventory that must be released. */
function holdsReservation(status) {
  return ORDER_STATUSES_HOLDING_RESERVATION.includes(status);
}

function isValidDeliveryTransition(from, to) {
  const allowed = DELIVERY_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function assertDeliveryTransition(from, to) {
  if (!isValidDeliveryTransition(from, to)) {
    throw AppError.businessRule(
      `Illegal delivery transition ${from} -> ${to}`,
      [{ field: 'status', allowed: DELIVERY_TRANSITIONS[from] || [] }]
    );
  }
  return true;
}

/** Order status implied by a delivery assignment status, if any. */
const DELIVERY_TO_ORDER_STATUS = {
  [DELIVERY_ASSIGNMENT_STATUS.ASSIGNED]: ORDER_STATUS.ASSIGNED,
  [DELIVERY_ASSIGNMENT_STATUS.PICKED_UP]: ORDER_STATUS.PICKED_UP,
  [DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT]: ORDER_STATUS.OUT_FOR_DELIVERY,
  [DELIVERY_ASSIGNMENT_STATUS.DELIVERED]: ORDER_STATUS.DELIVERED,
};

module.exports = {
  TRANSITION_ACTORS,
  isValidOrderTransition,
  allowedNextOrderStatuses,
  assertOrderTransition,
  assertCustomerMayCancel,
  isTerminal,
  holdsReservation,
  isValidDeliveryTransition,
  assertDeliveryTransition,
  DELIVERY_TO_ORDER_STATUS,
};
