'use strict';

const config = require('../config');
const { sequelize } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

/** Liveness: the process is up. Does not touch the database. */
const check = asyncHandler(async (req, res) =>
  ok(
    res,
    {
      status: 'UP',
      service: 'bottlebee-api',
      version: require('../package.json').version,
      environment: config.env,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    },
    'Service is healthy'
  ));

/** Readiness: the process can serve traffic, database included. */
const ready = asyncHandler(async (req, res) => {
  let database = 'UP';
  let databaseError = null;

  try {
    await sequelize.authenticate();
  } catch (err) {
    database = 'DOWN';
    databaseError = err.message;
  }

  const payload = {
    status: database === 'UP' ? 'READY' : 'NOT_READY',
    dependencies: { database, databaseError },
    timestamp: new Date().toISOString(),
  };

  return ok(res, payload, payload.status === 'READY' ? 'Service is ready' : 'Service is not ready',
    payload.status === 'READY' ? 200 : 503);
});

module.exports = { check, ready };
