'use strict';

/**
 * Operational error carrying an HTTP status and an optional structured
 * `errors` array. The error handler renders these directly; anything that is
 * not an AppError is treated as unexpected and rendered as a 500 with the
 * detail withheld from the client.
 */
class AppError extends Error {
  constructor(message, statusCode = 400, errors = [], code = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errors = errors;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', errors = []) {
    return new AppError(message, 400, errors, 'BAD_REQUEST');
  }

  static validation(message = 'Validation failed', errors = []) {
    return new AppError(message, 422, errors, 'VALIDATION_ERROR');
  }

  static unauthorized(message = 'Authentication required', errors = []) {
    return new AppError(message, 401, errors, 'UNAUTHORIZED');
  }

  static forbidden(message = 'You do not have permission to perform this action', errors = []) {
    return new AppError(message, 403, errors, 'FORBIDDEN');
  }

  static notFound(message = 'Resource not found', errors = []) {
    return new AppError(message, 404, errors, 'NOT_FOUND');
  }

  static conflict(message = 'Resource conflict', errors = []) {
    return new AppError(message, 409, errors, 'CONFLICT');
  }

  static tooManyRequests(message = 'Too many requests', errors = []) {
    return new AppError(message, 429, errors, 'RATE_LIMITED');
  }

  static internal(message = 'Something went wrong', errors = []) {
    const err = new AppError(message, 500, errors, 'INTERNAL_ERROR');
    err.isOperational = false;
    return err;
  }

  /** Business-rule rejection: syntactically valid, not allowed right now. */
  static businessRule(message, errors = []) {
    return new AppError(message, 409, errors, 'BUSINESS_RULE_VIOLATION');
  }

  /** A compliance or age-eligibility block. Distinct code so the UI can explain it. */
  static compliance(message, errors = []) {
    return new AppError(message, 403, errors, 'COMPLIANCE_BLOCKED');
  }
}

module.exports = AppError;
