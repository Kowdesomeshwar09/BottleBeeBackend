'use strict';

process.env.NODE_ENV = 'test';

const request = require('supertest');

const app = require('../../app');
const { sequelize } = require('../../models');

/**
 * Shared setup for integration tests.
 *
 * These run against `bottle_bee_test`, created by `npm run test:db:setup`. When
 * it is missing the suites skip rather than fail, so `npm test` stays useful on
 * a machine with no MySQL — a red suite should mean broken code, not a missing
 * local database.
 */

const api = request(app);

const CREDENTIALS = {
  admin: { email: 'admin@bottlebee.in', password: 'ChangeMe@12345' },
  customer: { email: 'customer@bottlebee.test', password: 'Bottle@Bee123' },
  vendor: { email: 'owner@jubileewines.test', password: 'Bottle@Bee123' },
  rider: { email: 'rider@bottlebee.test', password: 'Bottle@Bee123' },
};

/** True when the test database is reachable and seeded. */
async function isAvailable() {
  try {
    await sequelize.authenticate();
    const [rows] = await sequelize.query('SELECT COUNT(*) AS n FROM roles');
    return Number(rows[0].n) > 0;
  } catch (err) {
    return false;
  }
}

/** Signs in and returns the access token. */
async function login(who) {
  const creds = CREDENTIALS[who] || who;
  const res = await api.post('/api/v1/auth/login').send(creds);

  if (!res.body?.data?.tokens?.accessToken) {
    throw new Error(`Login failed for ${creds.email}: ${res.body?.message}`);
  }

  return res.body.data.tokens.accessToken;
}

/** A POST with the bearer token attached — every endpoint is a POST here. */
const post = (path, token, body = {}) => {
  const req = api.post(`/api/v1${path}`).send(body);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

/** Finds a live variant by SKU through the public catalog. */
async function findVariantBySku(sku) {
  const res = await post('/catalog/products/list', null, { limit: 100 });
  for (const product of res.body.data) {
    const variant = (product.variants || []).find((v) => v.sku === sku);
    if (variant) return { product, variant };
  }
  return null;
}

/** Empties the caller's cart so a test starts from a known state. */
const clearCart = (token) => post('/cart/clear', token);

async function close() {
  await sequelize.close();
}

module.exports = {
  app, api, post, login, isAvailable, findVariantBySku, clearCart, close, CREDENTIALS, sequelize,
};
