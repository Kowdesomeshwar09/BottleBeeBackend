'use strict';

/**
 * Centralized response envelope. Controllers must use these helpers and never
 * call res.json() directly, so every consumer of the API sees one shape.
 *
 *   success:   { success: true,  message, data, pagination? }
 *   error:     { success: false, message, errors, code? }
 */

function ok(res, data = null, message = 'Success', statusCode = 200, extra = {}) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...extra,
  });
}

function created(res, data = null, message = 'Created successfully') {
  return ok(res, data, message, 201);
}

function updated(res, data = null, message = 'Updated successfully') {
  return ok(res, data, message, 200);
}

function deleted(res, message = 'Deleted successfully') {
  return ok(res, null, message, 200);
}

function noContent(res) {
  return res.status(204).send();
}

/**
 * Paginated list response.
 * @param {object} res
 * @param {Array}  rows
 * @param {{page:number, limit:number, total:number}} meta
 */
function paginated(res, rows = [], meta = {}, message = 'Fetched successfully') {
  const page = Number(meta.page) || 1;
  const limit = Number(meta.limit) || rows.length || 0;
  const total = Number(meta.total) || 0;

  return res.status(200).json({
    success: true,
    message,
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      hasNext: limit > 0 && page * limit < total,
      hasPrevious: page > 1,
    },
  });
}

function fail(res, message = 'Request failed', statusCode = 400, errors = [], code = undefined) {
  const body = { success: false, message, errors };
  if (code) body.code = code;
  return res.status(statusCode).json(body);
}

module.exports = { ok, created, updated, deleted, noContent, paginated, fail };
