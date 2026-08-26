'use strict';

const AppError = require('../utils/AppError');

/**
 * Validates and replaces `req.body` with the Joi-coerced value.
 *
 * Every API input arrives in the body (project convention), so this middleware
 * only ever looks there. `stripUnknown` means a client cannot smuggle extra
 * attributes into a service — mass-assignment is impossible by construction.
 */
function validate(schema, options = {}) {
  return (req, res, next) => {
    if (!schema || typeof schema.validate !== 'function') {
      return next(new Error('validate() requires a Joi schema'));
    }

    const { value, error } = schema.validate(req.body ?? {}, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
      errors: { wrap: { label: false } },
      ...options,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.') || detail.context?.key || 'body',
        message: detail.message,
        type: detail.type,
      }));
      return next(AppError.validation('Validation failed', errors));
    }

    req.body = value;
    return next();
  };
}

module.exports = validate;
