'use strict';

const config = require('../config');
const { SORT_ORDER } = require('../config/constants');

/**
 * Normalises pagination and sorting taken from `req.body` (project convention:
 * every input, including list controls, arrives in the body).
 *
 * @param {object} body                 request body
 * @param {object} options
 * @param {string[]} options.sortable   whitelist of sortable model attributes
 * @param {string} options.defaultSort  default attribute
 * @param {string} options.defaultOrder ASC | DESC
 */
function buildPagination(body = {}, options = {}) {
  const { sortable = ['createdAt'], defaultSort = 'createdAt', defaultOrder = SORT_ORDER.DESC } = options;

  const rawPage = Number.parseInt(body.page, 10);
  const rawLimit = Number.parseInt(body.limit, 10);

  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  let limit = Number.isNaN(rawLimit) || rawLimit < 1 ? config.pagination.defaultLimit : rawLimit;
  if (limit > config.pagination.maxLimit) limit = config.pagination.maxLimit;

  // Never interpolate a client string into ORDER BY: only whitelisted
  // attributes are accepted, everything else silently falls back.
  const sortBy = sortable.includes(body.sortBy) ? body.sortBy : defaultSort;
  const sortOrder = String(body.sortOrder || defaultOrder).toUpperCase() === SORT_ORDER.ASC
    ? SORT_ORDER.ASC
    : SORT_ORDER.DESC;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    order: [[sortBy, sortOrder]],
    sortBy,
    sortOrder,
  };
}

/** Shapes a Sequelize findAndCountAll result for the paginated responder. */
function toPageMeta({ count }, { page, limit }) {
  return { page, limit, total: Array.isArray(count) ? count.length : count };
}

module.exports = { buildPagination, toPageMeta };
