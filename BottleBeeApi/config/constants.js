'use strict';

/**
 * Single source of truth for enums, roles, permissions and state machines.
 *
 * Anything that appears both in the database schema (as an ENUM) and in
 * application logic lives here so the two can never disagree. Migrations,
 * models, services and seeders all import from this file.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  VENDOR_OWNER: 'VENDOR_OWNER',
  VENDOR_MANAGER: 'VENDOR_MANAGER',
  CUSTOMER: 'CUSTOMER',
  DELIVERY_PARTNER: 'DELIVERY_PARTNER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
};

const ROLE_DEFINITIONS = [
  { code: ROLES.SUPER_ADMIN, name: 'Super Administrator', description: 'Unrestricted platform access. Cannot be deleted.' },
  { code: ROLES.ADMIN, name: 'Administrator', description: 'Platform operations, approvals and moderation.' },
  { code: ROLES.VENDOR_OWNER, name: 'Vendor Owner', description: 'Owns a licensed store and manages its staff, catalog and orders.' },
  { code: ROLES.VENDOR_MANAGER, name: 'Vendor Manager', description: 'Manages catalog, inventory and orders for a store.' },
  { code: ROLES.CUSTOMER, name: 'Customer', description: 'Places orders after age verification.' },
  { code: ROLES.DELIVERY_PARTNER, name: 'Delivery Partner', description: 'Picks up and delivers orders, verifies recipients.' },
  { code: ROLES.SUPPORT_AGENT, name: 'Support Agent', description: 'Read-mostly access for customer support and refund intake.' },
];

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const MODULES = {
  USER: 'USER',
  RBAC: 'RBAC',
  CUSTOMER: 'CUSTOMER',
  COMPLIANCE: 'COMPLIANCE',
  VENDOR: 'VENDOR',
  CATALOG: 'CATALOG',
  INVENTORY: 'INVENTORY',
  CART: 'CART',
  ORDER: 'ORDER',
  PAYMENT: 'PAYMENT',
  DELIVERY: 'DELIVERY',
  PROMOTION: 'PROMOTION',
  REVIEW: 'REVIEW',
  NOTIFICATION: 'NOTIFICATION',
  AUDIT: 'AUDIT',
  REPORT: 'REPORT',
};

/** code -> { module, description } */
const PERMISSION_DEFINITIONS = [
  // USER
  { code: 'USER_VIEW', module: MODULES.USER, description: 'View users and their details' },
  { code: 'USER_CREATE', module: MODULES.USER, description: 'Create users' },
  { code: 'USER_UPDATE', module: MODULES.USER, description: 'Update users and account status' },
  { code: 'USER_DELETE', module: MODULES.USER, description: 'Soft delete users' },

  // RBAC
  { code: 'ROLE_VIEW', module: MODULES.RBAC, description: 'View roles' },
  { code: 'ROLE_MANAGE', module: MODULES.RBAC, description: 'Create, update and assign roles' },
  { code: 'PERMISSION_VIEW', module: MODULES.RBAC, description: 'View permissions' },
  { code: 'PERMISSION_MANAGE', module: MODULES.RBAC, description: 'Assign permissions to roles' },

  // CUSTOMER
  { code: 'CUSTOMER_VIEW', module: MODULES.CUSTOMER, description: 'View customer profiles and addresses' },
  { code: 'CUSTOMER_MANAGE', module: MODULES.CUSTOMER, description: 'Manage own customer profile and addresses' },
  { code: 'CUSTOMER_ADMIN', module: MODULES.CUSTOMER, description: 'Administer any customer profile' },

  // COMPLIANCE
  { code: 'AGE_VERIFICATION_SUBMIT', module: MODULES.COMPLIANCE, description: 'Submit own age verification documents' },
  { code: 'AGE_VERIFICATION_VIEW', module: MODULES.COMPLIANCE, description: 'View age verification submissions' },
  { code: 'AGE_VERIFICATION_REVIEW', module: MODULES.COMPLIANCE, description: 'Approve or reject age verifications' },
  { code: 'COMPLIANCE_VIEW', module: MODULES.COMPLIANCE, description: 'View regional compliance rules' },
  { code: 'COMPLIANCE_MANAGE', module: MODULES.COMPLIANCE, description: 'Configure regional compliance rules' },

  // VENDOR
  { code: 'VENDOR_VIEW', module: MODULES.VENDOR, description: 'View vendors' },
  { code: 'VENDOR_APPLY', module: MODULES.VENDOR, description: 'Submit a vendor application' },
  { code: 'VENDOR_MANAGE', module: MODULES.VENDOR, description: 'Manage own vendor profile' },
  { code: 'VENDOR_APPROVE', module: MODULES.VENDOR, description: 'Approve, reject or suspend vendors' },
  { code: 'VENDOR_LICENSE_MANAGE', module: MODULES.VENDOR, description: 'Upload and update vendor licenses' },
  { code: 'VENDOR_LICENSE_REVIEW', module: MODULES.VENDOR, description: 'Review vendor licenses' },
  { code: 'VENDOR_STAFF_MANAGE', module: MODULES.VENDOR, description: 'Manage vendor staff membership' },

  // CATALOG
  { code: 'CATEGORY_MANAGE', module: MODULES.CATALOG, description: 'Manage categories' },
  { code: 'BRAND_MANAGE', module: MODULES.CATALOG, description: 'Manage brands' },
  { code: 'PRODUCT_VIEW', module: MODULES.CATALOG, description: 'View products including non-public states' },
  { code: 'PRODUCT_MANAGE', module: MODULES.CATALOG, description: 'Create and update products, variants and images' },
  { code: 'PRODUCT_APPROVE', module: MODULES.CATALOG, description: 'Approve or reject products' },

  // INVENTORY
  { code: 'INVENTORY_VIEW', module: MODULES.INVENTORY, description: 'View inventory levels and transactions' },
  { code: 'INVENTORY_MANAGE', module: MODULES.INVENTORY, description: 'Adjust stock levels' },

  // CART
  { code: 'CART_MANAGE', module: MODULES.CART, description: 'Manage own cart' },

  // ORDER
  { code: 'ORDER_PLACE', module: MODULES.ORDER, description: 'Checkout and place orders' },
  { code: 'ORDER_VIEW', module: MODULES.ORDER, description: 'View orders' },
  { code: 'ORDER_VIEW_ALL', module: MODULES.ORDER, description: 'View orders across all vendors and customers' },
  { code: 'ORDER_MANAGE', module: MODULES.ORDER, description: 'Advance order status' },
  { code: 'ORDER_CANCEL', module: MODULES.ORDER, description: 'Cancel orders' },

  // PAYMENT
  { code: 'PAYMENT_VIEW', module: MODULES.PAYMENT, description: 'View payments and transactions' },
  { code: 'PAYMENT_MANAGE', module: MODULES.PAYMENT, description: 'Initiate and confirm payments' },
  { code: 'REFUND_REQUEST', module: MODULES.PAYMENT, description: 'Request a refund' },
  { code: 'REFUND_MANAGE', module: MODULES.PAYMENT, description: 'Approve, reject and process refunds' },

  // DELIVERY
  { code: 'DELIVERY_VIEW', module: MODULES.DELIVERY, description: 'View delivery assignments and tracking' },
  { code: 'DELIVERY_ASSIGN', module: MODULES.DELIVERY, description: 'Assign delivery partners to orders' },
  { code: 'DELIVERY_EXECUTE', module: MODULES.DELIVERY, description: 'Accept, pick up, track and complete deliveries' },
  { code: 'DELIVERY_PARTNER_MANAGE', module: MODULES.DELIVERY, description: 'Manage own delivery partner profile' },
  { code: 'DELIVERY_PARTNER_APPROVE', module: MODULES.DELIVERY, description: 'Approve or suspend delivery partners' },

  // PROMOTION
  { code: 'PROMOTION_MANAGE', module: MODULES.PROMOTION, description: 'Manage promotions and banners' },
  { code: 'COUPON_MANAGE', module: MODULES.PROMOTION, description: 'Manage coupons' },

  // REVIEW
  { code: 'REVIEW_SUBMIT', module: MODULES.REVIEW, description: 'Submit reviews for delivered orders' },
  { code: 'REVIEW_VIEW', module: MODULES.REVIEW, description: 'View reviews including unmoderated ones' },
  { code: 'REVIEW_MODERATE', module: MODULES.REVIEW, description: 'Approve, reject or hide reviews' },

  // NOTIFICATION
  { code: 'NOTIFICATION_VIEW', module: MODULES.NOTIFICATION, description: 'View own notifications' },
  { code: 'NOTIFICATION_SEND', module: MODULES.NOTIFICATION, description: 'Send system notifications' },
  { code: 'NOTIFICATION_TEMPLATE_MANAGE', module: MODULES.NOTIFICATION, description: 'Manage notification templates' },

  // AUDIT + REPORT
  { code: 'AUDIT_VIEW', module: MODULES.AUDIT, description: 'View audit logs' },
  { code: 'REPORT_VIEW', module: MODULES.REPORT, description: 'View dashboards and reports' },
];

const PERMISSIONS = PERMISSION_DEFINITIONS.reduce((acc, p) => {
  acc[p.code] = p.code;
  return acc;
}, {});

const ALL_PERMISSION_CODES = PERMISSION_DEFINITIONS.map((p) => p.code);

/**
 * Role -> permission codes. SUPER_ADMIN is granted every permission implicitly
 * by the authorize middleware, but is also seeded with the full set so the
 * mapping is inspectable in the database.
 */
const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: ALL_PERMISSION_CODES,

  [ROLES.ADMIN]: [
    'USER_VIEW', 'USER_CREATE', 'USER_UPDATE', 'USER_DELETE',
    'ROLE_VIEW', 'ROLE_MANAGE', 'PERMISSION_VIEW', 'PERMISSION_MANAGE',
    'CUSTOMER_VIEW', 'CUSTOMER_ADMIN',
    'AGE_VERIFICATION_VIEW', 'AGE_VERIFICATION_REVIEW',
    'COMPLIANCE_VIEW', 'COMPLIANCE_MANAGE',
    'VENDOR_VIEW', 'VENDOR_APPROVE', 'VENDOR_LICENSE_REVIEW', 'VENDOR_STAFF_MANAGE',
    'CATEGORY_MANAGE', 'BRAND_MANAGE', 'PRODUCT_VIEW', 'PRODUCT_MANAGE', 'PRODUCT_APPROVE',
    'INVENTORY_VIEW',
    'ORDER_VIEW', 'ORDER_VIEW_ALL', 'ORDER_MANAGE', 'ORDER_CANCEL',
    'PAYMENT_VIEW', 'REFUND_MANAGE',
    'DELIVERY_VIEW', 'DELIVERY_ASSIGN', 'DELIVERY_PARTNER_APPROVE',
    'PROMOTION_MANAGE', 'COUPON_MANAGE',
    'REVIEW_VIEW', 'REVIEW_MODERATE',
    'NOTIFICATION_VIEW', 'NOTIFICATION_SEND', 'NOTIFICATION_TEMPLATE_MANAGE',
    'AUDIT_VIEW', 'REPORT_VIEW',
  ],

  [ROLES.VENDOR_OWNER]: [
    'VENDOR_VIEW', 'VENDOR_MANAGE', 'VENDOR_LICENSE_MANAGE', 'VENDOR_STAFF_MANAGE',
    'PRODUCT_VIEW', 'PRODUCT_MANAGE',
    'INVENTORY_VIEW', 'INVENTORY_MANAGE',
    'ORDER_VIEW', 'ORDER_MANAGE', 'ORDER_CANCEL',
    'PAYMENT_VIEW',
    'DELIVERY_VIEW',
    'REVIEW_VIEW',
    'NOTIFICATION_VIEW',
    'REPORT_VIEW',
  ],

  [ROLES.VENDOR_MANAGER]: [
    'VENDOR_VIEW',
    'PRODUCT_VIEW', 'PRODUCT_MANAGE',
    'INVENTORY_VIEW', 'INVENTORY_MANAGE',
    'ORDER_VIEW', 'ORDER_MANAGE',
    'DELIVERY_VIEW',
    'REVIEW_VIEW',
    'NOTIFICATION_VIEW',
  ],

  [ROLES.CUSTOMER]: [
    'CUSTOMER_MANAGE',
    'AGE_VERIFICATION_SUBMIT',
    'CART_MANAGE',
    'ORDER_PLACE', 'ORDER_VIEW', 'ORDER_CANCEL',
    'PAYMENT_MANAGE', 'PAYMENT_VIEW', 'REFUND_REQUEST',
    'DELIVERY_VIEW',
    'REVIEW_SUBMIT',
    'NOTIFICATION_VIEW',
  ],

  [ROLES.DELIVERY_PARTNER]: [
    'DELIVERY_PARTNER_MANAGE', 'DELIVERY_VIEW', 'DELIVERY_EXECUTE',
    'ORDER_VIEW',
    'NOTIFICATION_VIEW',
  ],

  [ROLES.SUPPORT_AGENT]: [
    'USER_VIEW',
    'CUSTOMER_VIEW',
    'AGE_VERIFICATION_VIEW',
    'VENDOR_VIEW',
    'PRODUCT_VIEW',
    'ORDER_VIEW', 'ORDER_VIEW_ALL', 'ORDER_CANCEL',
    'PAYMENT_VIEW', 'REFUND_REQUEST',
    'DELIVERY_VIEW',
    'REVIEW_VIEW',
    'NOTIFICATION_VIEW', 'NOTIFICATION_SEND',
    'REPORT_VIEW',
  ],
};

// ---------------------------------------------------------------------------
// Enums (mirrored exactly by the migrations)
// ---------------------------------------------------------------------------

const ACCOUNT_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
  DELETED: 'DELETED',
};

const GENDER = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
  PREFER_NOT_TO_SAY: 'PREFER_NOT_TO_SAY',
};

const DOCUMENT_TYPE = {
  AADHAAR: 'AADHAAR',
  PASSPORT: 'PASSPORT',
  DRIVING_LICENSE: 'DRIVING_LICENSE',
  VOTER_ID: 'VOTER_ID',
  OTHER: 'OTHER',
};

const VERIFICATION_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
};

const VENDOR_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
};

const VENDOR_ROLE = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
};

const PRODUCT_TYPE = {
  BEER: 'BEER',
  WINE: 'WINE',
  WHISKEY: 'WHISKEY',
  VODKA: 'VODKA',
  GIN: 'GIN',
  RUM: 'RUM',
  TEQUILA: 'TEQUILA',
  BRANDY: 'BRANDY',
  LIQUEUR: 'LIQUEUR',
  CHAMPAGNE: 'CHAMPAGNE',
  OTHER: 'OTHER',
};

const PRODUCT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  REJECTED: 'REJECTED',
};

const VARIANT_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
};

const INVENTORY_TRANSACTION_TYPE = {
  STOCK_IN: 'STOCK_IN',
  STOCK_OUT: 'STOCK_OUT',
  RESERVE: 'RESERVE',
  RELEASE: 'RELEASE',
  ADJUSTMENT: 'ADJUSTMENT',
  SALE: 'SALE',
  RETURN: 'RETURN',
};

const INVENTORY_REFERENCE_TYPE = {
  ORDER: 'ORDER',
  MANUAL: 'MANUAL',
  REFUND: 'REFUND',
  SYSTEM: 'SYSTEM',
};

const CART_STATUS = {
  ACTIVE: 'ACTIVE',
  ORDERED: 'ORDERED',
  ABANDONED: 'ABANDONED',
  EXPIRED: 'EXPIRED',
};

const ORDER_STATUS = {
  PLACED: 'PLACED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  ASSIGNED: 'ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
};

const ORDER_PAYMENT_STATUS = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
};

const ORDER_DELIVERY_STATUS = {
  PENDING: 'PENDING',
  ASSIGNED: 'ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

const PAYMENT_PROVIDER = {
  RAZORPAY: 'RAZORPAY',
  STRIPE: 'STRIPE',
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  WALLET: 'WALLET',
};

const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
};

const PAYMENT_TRANSACTION_TYPE = {
  AUTHORIZE: 'AUTHORIZE',
  CAPTURE: 'CAPTURE',
  FAILED: 'FAILED',
  REFUND: 'REFUND',
  WEBHOOK: 'WEBHOOK',
};

const REFUND_STATUS = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

const VEHICLE_TYPE = {
  BIKE: 'BIKE',
  SCOOTER: 'SCOOTER',
  CAR: 'CAR',
  VAN: 'VAN',
};

const DELIVERY_PARTNER_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  OFFLINE: 'OFFLINE',
};

const DELIVERY_ASSIGNMENT_STATUS = {
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

const DISCOUNT_TYPE = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
};

const COUPON_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  EXPIRED: 'EXPIRED',
};

const PROMOTION_TARGET_TYPE = {
  ALL: 'ALL',
  CATEGORY: 'CATEGORY',
  PRODUCT: 'PRODUCT',
  VENDOR: 'VENDOR',
};

const REVIEW_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  HIDDEN: 'HIDDEN',
};

const NOTIFICATION_CHANNEL = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  IN_APP: 'IN_APP',
};

const NOTIFICATION_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  READ: 'READ',
};

// ---------------------------------------------------------------------------
// Order state machine
// ---------------------------------------------------------------------------

/**
 * Allowed order transitions. Cancellation is expressed here rather than as a
 * blanket rule so the graph stays the only authority; DELIVERED and REFUNDED
 * are terminal for cancellation purposes.
 */
const ORDER_TRANSITIONS = {
  [ORDER_STATUS.PLACED]: [ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PAYMENT_FAILED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAYMENT_FAILED]: [ORDER_STATUS.PAYMENT_PENDING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY_FOR_PICKUP]: [ORDER_STATUS.ASSIGNED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ASSIGNED]: [ORDER_STATUS.PICKED_UP, ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PICKED_UP]: [ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.CANCELLED]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.REFUNDED]: [],
};

/** Statuses past which a customer may no longer self-cancel. */
const CUSTOMER_CANCELLABLE_STATUSES = [
  ORDER_STATUS.PLACED,
  ORDER_STATUS.PAYMENT_PENDING,
  ORDER_STATUS.PAYMENT_FAILED,
  ORDER_STATUS.CONFIRMED,
];

const ORDER_TERMINAL_STATUSES = [
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.REFUNDED,
];

/** Statuses that hold reserved stock and therefore must release it on cancel. */
const ORDER_STATUSES_HOLDING_RESERVATION = [
  ORDER_STATUS.PLACED,
  ORDER_STATUS.PAYMENT_PENDING,
  ORDER_STATUS.PAYMENT_FAILED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.ASSIGNED,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.OUT_FOR_DELIVERY,
];

const DELIVERY_TRANSITIONS = {
  [DELIVERY_ASSIGNMENT_STATUS.ASSIGNED]: [
    DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
    DELIVERY_ASSIGNMENT_STATUS.REJECTED,
    DELIVERY_ASSIGNMENT_STATUS.CANCELLED,
  ],
  [DELIVERY_ASSIGNMENT_STATUS.ACCEPTED]: [
    DELIVERY_ASSIGNMENT_STATUS.PICKED_UP,
    DELIVERY_ASSIGNMENT_STATUS.FAILED,
    DELIVERY_ASSIGNMENT_STATUS.CANCELLED,
  ],
  [DELIVERY_ASSIGNMENT_STATUS.PICKED_UP]: [
    DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT,
    DELIVERY_ASSIGNMENT_STATUS.FAILED,
  ],
  [DELIVERY_ASSIGNMENT_STATUS.IN_TRANSIT]: [
    DELIVERY_ASSIGNMENT_STATUS.DELIVERED,
    DELIVERY_ASSIGNMENT_STATUS.FAILED,
  ],
  [DELIVERY_ASSIGNMENT_STATUS.DELIVERED]: [],
  [DELIVERY_ASSIGNMENT_STATUS.REJECTED]: [],
  [DELIVERY_ASSIGNMENT_STATUS.FAILED]: [],
  [DELIVERY_ASSIGNMENT_STATUS.CANCELLED]: [],
};

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

const SORT_ORDER = { ASC: 'ASC', DESC: 'DESC' };

const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  ROLES_ASSIGNED: 'ROLES_ASSIGNED',
  ROLE_PERMISSIONS_UPDATED: 'ROLE_PERMISSIONS_UPDATED',
  AGE_VERIFICATION_SUBMITTED: 'AGE_VERIFICATION_SUBMITTED',
  AGE_VERIFICATION_REVIEWED: 'AGE_VERIFICATION_REVIEWED',
  COMPLIANCE_RULE_UPDATED: 'COMPLIANCE_RULE_UPDATED',
  VENDOR_APPLIED: 'VENDOR_APPLIED',
  VENDOR_REVIEWED: 'VENDOR_REVIEWED',
  VENDOR_LICENSE_REVIEWED: 'VENDOR_LICENSE_REVIEWED',
  PRODUCT_REVIEWED: 'PRODUCT_REVIEWED',
  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  ORDER_PLACED: 'ORDER_PLACED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  PAYMENT_WEBHOOK_RECEIVED: 'PAYMENT_WEBHOOK_RECEIVED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_REVIEWED: 'REFUND_REVIEWED',
  DELIVERY_ASSIGNED: 'DELIVERY_ASSIGNED',
  DELIVERY_STATUS_CHANGED: 'DELIVERY_STATUS_CHANGED',
  RECIPIENT_VERIFIED: 'RECIPIENT_VERIFIED',
  REVIEW_MODERATED: 'REVIEW_MODERATED',
  DELIVERY_PARTNER_REVIEWED: 'DELIVERY_PARTNER_REVIEWED',
};

module.exports = {
  ROLES,
  ROLE_DEFINITIONS,
  MODULES,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ALL_PERMISSION_CODES,
  ROLE_PERMISSIONS,
  ACCOUNT_STATUS,
  GENDER,
  DOCUMENT_TYPE,
  VERIFICATION_STATUS,
  VENDOR_STATUS,
  VENDOR_ROLE,
  PRODUCT_TYPE,
  PRODUCT_STATUS,
  VARIANT_STATUS,
  INVENTORY_TRANSACTION_TYPE,
  INVENTORY_REFERENCE_TYPE,
  CART_STATUS,
  ORDER_STATUS,
  ORDER_PAYMENT_STATUS,
  ORDER_DELIVERY_STATUS,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_TYPE,
  REFUND_STATUS,
  VEHICLE_TYPE,
  DELIVERY_PARTNER_STATUS,
  DELIVERY_ASSIGNMENT_STATUS,
  DISCOUNT_TYPE,
  COUPON_STATUS,
  PROMOTION_TARGET_TYPE,
  REVIEW_STATUS,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
  ORDER_TRANSITIONS,
  DELIVERY_TRANSITIONS,
  CUSTOMER_CANCELLABLE_STATUSES,
  ORDER_TERMINAL_STATUSES,
  ORDER_STATUSES_HOLDING_RESERVATION,
  SORT_ORDER,
  AUDIT_ACTIONS,
  enumValues: (obj) => Object.values(obj),
};
