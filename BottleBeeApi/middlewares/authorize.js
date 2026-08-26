'use strict';

const { ROLES } = require('../config/constants');
const AppError = require('../utils/AppError');

/**
 * RBAC guards. Both run after `authenticate`, so a missing `req.user` is a
 * wiring bug and is reported as 401 rather than silently allowing the request.
 */

/**
 * Requires every listed permission (AND). Use `authorize.any(...)` for OR.
 * SUPER_ADMIN bypasses the check by design — it is the break-glass role.
 */
function authorize(...required) {
  const needed = required.flat().filter(Boolean);

  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized('Authentication required'));
    if (req.user.isSuperAdmin) return next();

    const held = new Set(req.user.permissions || []);
    const missing = needed.filter((code) => !held.has(code));

    if (missing.length) {
      return next(
        AppError.forbidden(
          'You do not have permission to perform this action',
          [{ field: 'permissions', required: needed, missing }]
        )
      );
    }
    return next();
  };
}

/** Requires at least one of the listed permissions (OR). */
authorize.any = function authorizeAny(...required) {
  const needed = required.flat().filter(Boolean);

  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized('Authentication required'));
    if (req.user.isSuperAdmin) return next();

    const held = new Set(req.user.permissions || []);
    if (needed.some((code) => held.has(code))) return next();

    return next(
      AppError.forbidden(
        'You do not have permission to perform this action',
        [{ field: 'permissions', requiresAnyOf: needed }]
      )
    );
  };
};

/** Requires one of the listed roles. Prefer permissions; use this for role-scoped surfaces. */
function requireRole(...roles) {
  const allowed = roles.flat().filter(Boolean);

  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized('Authentication required'));
    if (req.user.isSuperAdmin) return next();

    if (!(req.user.roles || []).some((role) => allowed.includes(role))) {
      return next(
        AppError.forbidden('This endpoint is not available for your role', [
          { field: 'roles', requiresAnyOf: allowed },
        ])
      );
    }
    return next();
  };
}

const requireAdmin = requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
const requireCustomer = requireRole(ROLES.CUSTOMER);
const requireVendor = requireRole(ROLES.VENDOR_OWNER, ROLES.VENDOR_MANAGER);
const requireDeliveryPartner = requireRole(ROLES.DELIVERY_PARTNER);

module.exports = {
  authorize,
  requireRole,
  requireAdmin,
  requireCustomer,
  requireVendor,
  requireDeliveryPartner,
};
