'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const env = process.env.NODE_ENV || 'development';
const isTest = env === 'test';
const isProduction = env === 'production';

/** Parse an integer env var, falling back when unset or unparseable. */
const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const list = (value, fallback = []) =>
  value ? String(value).split(',').map((v) => v.trim()).filter(Boolean) : fallback;

const config = {
  env,
  isTest,
  isProduction,
  isDevelopment: env === 'development',
  port: int(process.env.PORT, 5000),
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:5000',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 3306),
    name: isTest
      ? process.env.DB_NAME_TEST || 'bottle_bee_test'
      : process.env.DB_NAME || 'bottle_bee',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    poolMax: int(process.env.DB_POOL_MAX, 10),
    poolMin: int(process.env.DB_POOL_MIN, 0),
    logging: bool(process.env.DB_LOGGING, false),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'bottlebee',
  },

  cors: {
    origins: list(process.env.CORS_ORIGIN, ['http://localhost:4200']),
  },

  payment: {
    provider: (process.env.PAYMENT_PROVIDER || 'MOCK').toUpperCase(),
    keyId: process.env.PAYMENT_KEY_ID || '',
    keySecret: process.env.PAYMENT_KEY_SECRET || '',
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    currency: process.env.PAYMENT_CURRENCY || 'INR',
  },

  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxSizeMb: int(process.env.UPLOAD_MAX_SIZE_MB, 5),
    get maxSizeBytes() {
      return this.maxSizeMb * 1024 * 1024;
    },
    allowedImageMimes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedDocumentMimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  },

  security: {
    bcryptSaltRounds: int(process.env.BCRYPT_SALT_ROUNDS, isTest ? 4 : 12),
    maxLoginAttempts: int(process.env.MAX_LOGIN_ATTEMPTS, 5),
    accountLockMinutes: int(process.env.ACCOUNT_LOCK_MINUTES, 15),
    passwordResetExpiresMinutes: int(process.env.PASSWORD_RESET_EXPIRES_MINUTES, 30),
  },

  rateLimit: {
    windowMinutes: int(process.env.RATE_LIMIT_WINDOW_MINUTES, 15),
    max: int(process.env.RATE_LIMIT_MAX, 300),
    authMax: int(process.env.AUTH_RATE_LIMIT_MAX, 10),
    checkoutMax: int(process.env.CHECKOUT_RATE_LIMIT_MAX, 20),
  },

  compliance: {
    defaultRegionCode: process.env.DEFAULT_REGION_CODE || 'IN-TS',
    defaultMinimumAge: int(process.env.DEFAULT_MINIMUM_AGE, 21),
  },

  fulfilment: {
    // Flat delivery fee, waived once the discounted subtotal reaches the
    // threshold. A vendor's own minimum order value is enforced separately.
    deliveryFee: Number(process.env.DELIVERY_FEE ?? 49),
    freeDeliveryAbove: Number(process.env.FREE_DELIVERY_ABOVE ?? 1500),
    // How long an untouched cart stays claimable before it is abandoned.
    cartExpiryHours: int(process.env.CART_EXPIRY_HOURS, 72),
    // Grace period in which a customer may still cancel a confirmed order.
    cancellationWindowMinutes: int(process.env.CANCELLATION_WINDOW_MINUTES, 5),
  },

  log: {
    level: process.env.LOG_LEVEL || (isTest ? 'error' : 'info'),
    dir: process.env.LOG_DIR || 'logs',
  },

  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || 'admin@bottlebee.in',
    password: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@12345',
    phone: process.env.SUPER_ADMIN_PHONE || '+919000000001',
  },

  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
};

if (!config.apiBaseUrl) config.apiBaseUrl = 'http://localhost:' + config.port;

/**
 * Fail fast on missing secrets rather than signing tokens with undefined.
 * Tests get deterministic throwaway secrets so the suite runs without a .env.
 */
if (!config.jwt.accessSecret || !config.jwt.refreshSecret) {
  if (isTest) {
    config.jwt.accessSecret = config.jwt.accessSecret || 'test-access-secret';
    config.jwt.refreshSecret = config.jwt.refreshSecret || 'test-refresh-secret';
  } else {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set. Copy .env.example to .env and populate them.'
    );
  }
}

if (isProduction && config.jwt.accessSecret === config.jwt.refreshSecret) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ in production.');
}

module.exports = config;
