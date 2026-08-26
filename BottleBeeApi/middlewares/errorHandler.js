'use strict';

const { BaseError, ValidationError, UniqueConstraintError, ForeignKeyConstraintError, DatabaseError,
  TimeoutError, OptimisticLockError } = require('sequelize');
const multer = require('multer');

const config = require('../config');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const { fail } = require('../utils/response');

/** 404 for any route that did not match. */
function notFound(req, res, next) {
  return next(AppError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}

/**
 * Translates driver and library errors into the centralized error envelope.
 * Raw Sequelize messages never reach the client: they leak column names,
 * constraint names and sometimes values.
 */
function normalize(err) {
  if (err instanceof AppError) return err;

  if (err instanceof UniqueConstraintError) {
    const errors = (err.errors || []).map((e) => ({
      field: e.path,
      message: `${e.path} is already in use`,
    }));
    return AppError.conflict('A record with these details already exists', errors);
  }

  if (err instanceof ValidationError) {
    const errors = (err.errors || []).map((e) => ({ field: e.path, message: e.message }));
    return AppError.validation('Validation failed', errors);
  }

  if (err instanceof ForeignKeyConstraintError) {
    return AppError.conflict(
      'This operation references a record that does not exist, or is blocked by a related record'
    );
  }

  if (err instanceof TimeoutError) {
    return new AppError('The database took too long to respond. Please retry.', 503, [], 'DB_TIMEOUT');
  }

  if (err instanceof OptimisticLockError) {
    return AppError.conflict('This record was modified by someone else. Please reload and retry.');
  }

  if (err instanceof DatabaseError) {
    // CHECK constraint violations surface here (MySQL error 3819).
    if (err.parent && err.parent.errno === 3819) {
      return AppError.businessRule('This change violates a data integrity rule');
    }
    return AppError.internal('A database error occurred');
  }

  if (err instanceof BaseError) return AppError.internal('A database error occurred');

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return AppError.validation(`File is larger than the ${config.upload.maxSizeMb} MB limit`, [
        { field: err.field, message: 'File too large' },
      ]);
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return AppError.validation('Unexpected file field', [{ field: err.field, message: 'Not accepted' }]);
    }
    return AppError.validation(`Upload failed: ${err.code}`);
  }

  if (err.type === 'entity.parse.failed') {
    return AppError.badRequest('Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return AppError.badRequest('Request body is too large');
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return AppError.unauthorized('Invalid or expired token');
  }

  return AppError.internal(err.message || 'Something went wrong');
}

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  const appError = normalize(err);

  const context = {
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
    statusCode: appError.statusCode,
  };

  if (appError.statusCode >= 500 || !appError.isOperational) {
    logger.error('Unhandled error: %s', err.message, { ...context, stack: err.stack });
  } else {
    logger.warn('Request rejected: %s', appError.message, context);
  }

  // A 500 body never carries the internal message in production.
  const message = appError.statusCode >= 500 && config.isProduction
    ? 'Something went wrong. Please try again.'
    : appError.message;

  return fail(res, message, appError.statusCode, appError.errors || [], appError.code);
}
/* eslint-enable no-unused-vars */

module.exports = { errorHandler, notFound, normalize };
