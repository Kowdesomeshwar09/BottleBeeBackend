'use strict';

const config = require('./config');
const logger = require('./config/logger');
const app = require('./app');
const { assertDatabaseConnection, closeDatabaseConnection } = require('./config/database');

let server;

async function start() {
  try {
    await assertDatabaseConnection();
  } catch (err) {
    logger.error('Cannot reach the database: %s', err.message);
    logger.error('Check DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD in .env, then run: npm run db:setup');
    process.exit(1);
  }

  server = app.listen(config.port, () => {
    logger.info('Bottle Bee API listening on port %s (%s)', config.port, config.env);
    logger.info('API docs: %s/api-docs', config.apiBaseUrl);
  });
}

/** Stop accepting connections, drain, then close the pool. */
async function shutdown(signal) {
  logger.info('%s received — shutting down', signal);

  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    // `server` exists but is not listening when startup itself failed (for
    // example EADDRINUSE); calling close() then throws instead of shutting down.
    if (server && server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await closeDatabaseConnection();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown: %s', err.message);
    process.exit(1);
  }
}

['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection: %s', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception: %s', err.stack || err.message);
  shutdown('uncaughtException');
});

start();
