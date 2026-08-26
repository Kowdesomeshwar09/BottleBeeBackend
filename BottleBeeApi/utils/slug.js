'use strict';

const { Op } = require('sequelize');

/** URL-safe slug from arbitrary text. */
function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

/**
 * Produce a slug unique within `model`, appending -2, -3 ... as needed.
 * `scope` lets a slug be unique per vendor rather than globally (products).
 */
async function uniqueSlug(model, text, { scope = {}, excludeId = null, transaction = null, column = 'slug' } = {}) {
  const base = slugify(text) || 'item';
  let candidate = base;
  let suffix = 1;

  /* eslint-disable no-await-in-loop */
  while (true) {
    const where = { ...scope, [column]: candidate };
    if (excludeId) where.id = { [Op.ne]: excludeId };

    const existing = await model.findOne({ where, transaction, paranoid: false, attributes: ['id'] });
    if (!existing) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  /* eslint-enable no-await-in-loop */
}

module.exports = { slugify, uniqueSlug };
