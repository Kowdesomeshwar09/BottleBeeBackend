'use strict';

const constants = require('../config/constants');

/**
 * Reusable OpenAPI components.
 *
 * Enum lists are generated from config/constants so the published contract can
 * never drift from what the database and services actually accept.
 */

const enumOf = (obj) => ({ type: 'string', enum: Object.values(obj) });

const securitySchemes = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Access token returned by POST /api/v1/auth/login.',
  },
};

const schemas = {
  SuccessResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Operation completed successfully' },
      data: { type: 'object', nullable: true },
    },
  },

  PaginatedResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Fetched successfully' },
      data: { type: 'array', items: { type: 'object' } },
      pagination: { $ref: '#/components/schemas/Pagination' },
    },
  },

  Pagination: {
    type: 'object',
    properties: {
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      total: { type: 'integer', example: 137 },
      totalPages: { type: 'integer', example: 7 },
      hasNext: { type: 'boolean', example: true },
      hasPrevious: { type: 'boolean', example: false },
    },
  },

  ErrorResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string', example: 'Validation failed' },
      errors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', example: 'email' },
            message: { type: 'string', example: 'email must be a valid email' },
          },
        },
      },
      code: { type: 'string', example: 'VALIDATION_ERROR' },
    },
  },

  ListRequest: {
    type: 'object',
    description: 'Standard list controls. All list endpoints are POST and read these from the body.',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      sortBy: { type: 'string', example: 'createdAt' },
      sortOrder: { type: 'string', enum: ['ASC', 'DESC'], default: 'DESC' },
      search: { type: 'string', nullable: true },
    },
  },

  IdRequest: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', example: 1 } },
  },

  AuthTokens: {
    type: 'object',
    properties: {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      accessTokenExpiresIn: { type: 'string', example: '15m' },
      refreshTokenExpiresAt: { type: 'string', format: 'date-time' },
    },
  },

  PublicUser: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      firstName: { type: 'string' },
      lastName: { type: 'string', nullable: true },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string', nullable: true },
      accountStatus: enumOf(constants.ACCOUNT_STATUS),
      emailVerified: { type: 'boolean' },
      phoneVerified: { type: 'boolean' },
      roles: { type: 'array', items: { type: 'string' } },
      permissions: { type: 'array', items: { type: 'string' } },
    },
  },

  // Enum vocabularies, referenced by request and response bodies.
  AccountStatus: enumOf(constants.ACCOUNT_STATUS),
  Gender: enumOf(constants.GENDER),
  DocumentType: enumOf(constants.DOCUMENT_TYPE),
  VerificationStatus: enumOf(constants.VERIFICATION_STATUS),
  VendorStatus: enumOf(constants.VENDOR_STATUS),
  VendorRole: enumOf(constants.VENDOR_ROLE),
  ProductType: enumOf(constants.PRODUCT_TYPE),
  ProductStatus: enumOf(constants.PRODUCT_STATUS),
  VariantStatus: enumOf(constants.VARIANT_STATUS),
  InventoryTransactionType: enumOf(constants.INVENTORY_TRANSACTION_TYPE),
  CartStatus: enumOf(constants.CART_STATUS),
  OrderStatus: enumOf(constants.ORDER_STATUS),
  OrderPaymentStatus: enumOf(constants.ORDER_PAYMENT_STATUS),
  OrderDeliveryStatus: enumOf(constants.ORDER_DELIVERY_STATUS),
  PaymentProvider: enumOf(constants.PAYMENT_PROVIDER),
  PaymentStatus: enumOf(constants.PAYMENT_STATUS),
  RefundStatus: enumOf(constants.REFUND_STATUS),
  VehicleType: enumOf(constants.VEHICLE_TYPE),
  DeliveryPartnerStatus: enumOf(constants.DELIVERY_PARTNER_STATUS),
  DeliveryAssignmentStatus: enumOf(constants.DELIVERY_ASSIGNMENT_STATUS),
  DiscountType: enumOf(constants.DISCOUNT_TYPE),
  CouponStatus: enumOf(constants.COUPON_STATUS),
  PromotionTargetType: enumOf(constants.PROMOTION_TARGET_TYPE),
  ReviewStatus: enumOf(constants.REVIEW_STATUS),
  NotificationChannel: enumOf(constants.NOTIFICATION_CHANNEL),
  NotificationStatus: enumOf(constants.NOTIFICATION_STATUS),
};

const responses = {
  BadRequest: {
    description: 'Malformed request',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  Unauthorized: {
    description: 'Missing, invalid or expired access token',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  Forbidden: {
    description: 'Authenticated but lacking the required permission, or blocked by compliance',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  NotFound: {
    description: 'Resource does not exist',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  Conflict: {
    description: 'Business rule violation or duplicate record',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  ValidationError: {
    description: 'Input failed validation',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  RateLimited: {
    description: 'Too many requests',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  ServerError: {
    description: 'Unexpected server error',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
};

module.exports = { securitySchemes, schemas, responses };
