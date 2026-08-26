'use strict';

const fs = require('fs');
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const config = require('./index');

const logDir = path.resolve(process.cwd(), config.log.dir);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const consoleFormat = winston.format.printf((info) => {
  const { level, message, timestamp, stack, service, env, ...meta } = info;
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${stack || message}${extra}`;
});

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(winston.format.colorize(), consoleFormat),
    silent: config.isTest,
  }),
];

if (!config.isTest) {
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'bottlebee-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      level: config.log.level,
    }),
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'bottlebee-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
    })
  );
}

const logger = winston.createLogger({
  level: config.log.level,
  defaultMeta: { service: 'bottlebee-api', env: config.env },
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports,
  exitOnError: false,
});

/** morgan writes single lines that already end with a newline. */
logger.stream = {
  write: (message) => logger.http
    ? logger.http(message.trim())
    : logger.info(message.trim()),
};

module.exports = logger;
