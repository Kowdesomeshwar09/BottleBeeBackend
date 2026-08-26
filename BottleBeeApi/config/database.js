'use strict';

const { Sequelize } = require('sequelize');

const config = require('./index');
const logger = require('./logger');

/**
 * The single Sequelize instance used by the running application.
 * Migrations and seeders go through sequelize-cli (config/sequelize-cli.js),
 * which reads the same env, so schema and runtime never diverge.
 */
const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, {
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  logging: config.db.logging ? (msg) => logger.debug(msg) : false,
  pool: {
    max: config.db.poolMax,
    min: config.db.poolMin,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    underscored: true,
    timestamps: true,
    paranoid: true,
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    engine: 'InnoDB',
  },
  dialectOptions: {
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
  },
  // Sequelize returns DECIMAL as a string by default; the app treats money as
  // a number everywhere, so `decimalNumbers` above normalises it at the driver.
  timezone: '+00:00',
  benchmark: config.isDevelopment,
});

/** Verify connectivity at boot so a bad DB config fails loudly, not lazily. */
async function assertDatabaseConnection() {
  await sequelize.authenticate();
  logger.info('Database connection established (%s@%s:%s)', config.db.name, config.db.host, config.db.port);
}

async function closeDatabaseConnection() {
  await sequelize.close();
  logger.info('Database connection closed');
}

module.exports = { sequelize, Sequelize, assertDatabaseConnection, closeDatabaseConnection };
