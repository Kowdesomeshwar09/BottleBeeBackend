'use strict';

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const config = require('../config');
const { securitySchemes, schemas, responses } = require('./components');

/**
 * OpenAPI 3 specification, assembled from @openapi JSDoc blocks in routes/.
 *
 * Documentation lives next to the route it describes so it stays current when
 * the route changes; only shared components live in this folder.
 */
const definition = {
  openapi: '3.0.3',
  info: {
    title: 'Bottle Bee API',
    version: '1.0.0',
    description: [
      '**Bottle Bee — Cheers Delivered Fast.**',
      '',
      'Marketplace and logistics API for compliant alcohol delivery from licensed stores.',
      '',
      '### Conventions',
      '',
      '- Every endpoint is `POST`, including list, detail, update and delete operations.',
      '- Every input is read from the JSON request body. Query strings and path parameters are not used for business identifiers.',
      '- Every response uses the envelope `{ success, message, data }`; list responses add `pagination`.',
      '- Authenticate with `Authorization: Bearer <accessToken>` from `/auth/login`.',
      '- Endpoints marked with a required permission are enforced by RBAC middleware. `SUPER_ADMIN` bypasses permission checks.',
      '',
      '### Compliance',
      '',
      'Checkout is refused unless the customer has an approved age verification, the vendor holds a valid licence for the',
      'delivery region, and the order satisfies that region\'s rules (minimum age, dry days, sale window, quantity and value caps).',
    ].join('\n'),
    contact: { name: 'Bottle Bee Engineering' },
  },
  servers: [
    { url: config.apiBaseUrl, description: `${config.env} server` },
  ],
  tags: [
    { name: 'Health', description: 'Liveness and readiness' },
    { name: 'Auth', description: 'Registration, login, session rotation and password recovery' },
    { name: 'Users', description: 'User administration' },
    { name: 'RBAC', description: 'Roles, permissions and assignments' },
    { name: 'Customer', description: 'Customer profile and addresses' },
    { name: 'Age Verification', description: 'KYC submission and review' },
    { name: 'Compliance', description: 'Regional rules governing alcohol sale' },
    { name: 'Vendors', description: 'Store onboarding, licences and staff' },
    { name: 'Catalog', description: 'Categories, brands, products and variants' },
    { name: 'Public Catalog', description: 'Unauthenticated browsing, search and filtering' },
    { name: 'Inventory', description: 'Stock levels and the movement ledger' },
    { name: 'Cart', description: 'Cart contents, coupons and totals' },
    { name: 'Orders', description: 'Checkout, order lifecycle and cancellation' },
    { name: 'Payments', description: 'Payment intents, confirmation, webhooks and refunds' },
    { name: 'Delivery', description: 'Assignment, tracking and recipient verification' },
    { name: 'Promotions', description: 'Coupons and promotional banners' },
    { name: 'Reviews', description: 'Review submission and moderation' },
    { name: 'Notifications', description: 'In-app notifications and templates' },
    { name: 'Admin', description: 'Dashboards and audit logs' },
  ],
  components: { securitySchemes, schemas, responses },
  security: [{ bearerAuth: [] }],
};

const spec = swaggerJsdoc({
  definition,
  apis: [
    path.resolve(__dirname, '..', 'routes', '**', '*.js'),
  ],
});

module.exports = spec;
