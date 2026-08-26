'use strict';

/**
 * Unit tests run without a database: they cover the pure logic where a silent
 * error is most expensive — money arithmetic, the order state machine, and the
 * compliance date and time rules.
 *
 * Integration tests need `bottle_bee_test`, created and migrated by
 * `npm run test:db:setup`. They are skipped automatically when it is absent, so
 * `npm test` stays useful on a machine with no MySQL.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'controllers/**/*.js',
    'services/**/*.js',
    'utils/**/*.js',
    'middlewares/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  // The suite touches a real database; parallel workers would fight over rows.
  maxWorkers: 1,
  testTimeout: 20000,
  verbose: true,
  clearMocks: true,
};
