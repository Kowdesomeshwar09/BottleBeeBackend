'use strict';

const morgan = require('morgan');

const config = require('../config');
const logger = require('../config/logger');

/**
 * HTTP access log routed through winston so console and file output share one
 * format. Health checks are skipped to keep the log readable under a load
 * balancer that polls every few seconds.
 */
morgan.token('user', (req) => (req.user ? String(req.user.id) : '-'));

const format = config.isProduction
  ? ':remote-addr :user ":method :url" :status :res[content-length] :response-time ms'
  : ':method :url :status :response-time ms - user=:user';

const requestLogger = morgan(format, {
  stream: { write: (message) => logger.info(message.trim()) },
  skip: (req) => config.isTest || req.originalUrl.includes('/health'),
});

module.exports = requestLogger;
