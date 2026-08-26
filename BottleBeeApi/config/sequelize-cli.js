'use strict';

/**
 * Configuration consumed by sequelize-cli (migrations and seeders).
 * The runtime Sequelize instance lives in config/database.js; both read the same
 * env through config/index.js so the CLI and the app can never drift apart.
 */
const config = require('./index');

const base = {
  username: config.db.user,
  password: config.db.password,
  database: config.db.name,
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
  define: {
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    engine: 'InnoDB',
    underscored: true,
  },
  dialectOptions: {
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
  },
  logging: config.db.logging ? console.log : false,
  migrationStorageTableName: 'sequelize_meta',
  seederStorage: 'sequelize',
  seederStorageTableName: 'sequelize_seeder_meta',
};

module.exports = {
  development: base,
  test: {
    ...base,
    database: process.env.DB_NAME_TEST || 'bottle_bee_test',
    logging: false,
  },
  production: base,
};
