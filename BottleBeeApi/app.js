'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const logger = require('./config/logger');
const routes = require('./routes');
const swaggerSpec = require('./swagger');
const requestLogger = require('./middlewares/requestLogger');
const { globalLimiter } = require('./middlewares/rateLimiters');
const { errorHandler, notFound } = require('./middlewares/errorHandler');

const app = express();

// Behind a load balancer or reverse proxy, trust the forwarding headers so
// req.ip (used by rate limits and the audit trail) reflects the real client.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  // Swagger UI needs inline styles; the API itself serves no HTML.
  contentSecurityPolicy: config.isProduction ? undefined : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin(origin, callback) {
    // Server-to-server calls and same-origin requests arrive without an Origin.
    if (!origin) return callback(null, true);
    if (config.cors.origins.includes(origin) || config.cors.origins.includes('*')) {
      return callback(null, true);
    }
    logger.warn('Blocked CORS request from origin %s', origin);
    return callback(new Error('Origin not allowed by CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Razorpay-Signature'],
  maxAge: 86400,
}));

app.use(compression());

/**
 * The payment webhook needs the byte-exact body to verify its HMAC signature,
 * so it captures the raw buffer before JSON parsing rewrites it.
 */
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => {
    if (req.originalUrl.includes('/payments/webhook')) {
      req.rawBody = buf.toString('utf8');
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(requestLogger);
app.use('/api', globalLimiter);

// Uploaded documents and images. Served read-only; nothing here is executable.
app.use(
  `/${config.upload.dir}`,
  express.static(path.resolve(process.cwd(), config.upload.dir), {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
  })
);

app.use('/api', routes);

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Bottle Bee API — Cheers Delivered Fast',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true },
  })
);

/** Machine-readable spec, for client generation. */
app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));

app.get('/', (req, res) => res.json({
  success: true,
  message: 'Bottle Bee API — Cheers Delivered Fast.',
  data: { version: require('./package.json').version, docs: '/api-docs', health: '/api/v1/health/check' },
}));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
