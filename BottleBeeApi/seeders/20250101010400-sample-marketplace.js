'use strict';

const bcrypt = require('bcryptjs');

const config = require('../config');
const {
  ROLES, ACCOUNT_STATUS, VENDOR_STATUS, VENDOR_ROLE, VERIFICATION_STATUS,
  PRODUCT_STATUS, VARIANT_STATUS, PRODUCT_TYPE, DELIVERY_PARTNER_STATUS,
  VEHICLE_TYPE, DISCOUNT_TYPE, COUPON_STATUS,
} = require('../config/constants');

/**
 * Sample marketplace: one licensed store with real stock, a verified customer,
 * a delivery partner and a working coupon.
 *
 * This exists so the purchase path can actually be exercised. Checkout refuses
 * an order unless a licensed, approved store holds stock and the customer has an
 * approved age verification — so a database with only RBAC and a catalog cannot
 * demonstrate a single order.
 *
 * Everything here is obviously fake: the store is "Jubilee Hills Wine Mart", the
 * licence number is marked SAMPLE, and every password is the same known value.
 * Do not run this seeder against production.
 */

const SAMPLE_PASSWORD = 'Bottle@Bee123';

const VENDOR_OWNER = {
  email: 'owner@jubileewines.test',
  firstName: 'Arjun',
  lastName: 'Reddy',
  phone: '+919000000010',
};

const CUSTOMER = {
  email: 'customer@bottlebee.test',
  firstName: 'Priya',
  lastName: 'Sharma',
  phone: '+919000000011',
  dateOfBirth: '1994-06-15',
};

const DELIVERY_PARTNER = {
  email: 'rider@bottlebee.test',
  firstName: 'Imran',
  lastName: 'Khan',
  phone: '+919000000012',
};

/** slug -> the products to create under it. */
const PRODUCTS = [
  {
    slug: 'whisky-single-malt',
    brandSlug: 'glenfiddich',
    name: 'Glenfiddich 12 Year Old Single Malt',
    productType: PRODUCT_TYPE.WHISKEY,
    alcoholPercentage: 40.0,
    originCountry: 'Scotland',
    description: 'Matured in American oak and European sherry casks. Pear, oak and a long, mellow finish.',
    variants: [
      { sku: 'GLEN12-750', sizeMl: 750, mrp: 6200.00, sellingPrice: 5899.00, taxPercent: 18, stock: 24, reorder: 6 },
      { sku: 'GLEN12-1000', sizeMl: 1000, mrp: 7900.00, sellingPrice: 7499.00, taxPercent: 18, stock: 12, reorder: 4 },
    ],
  },
  {
    slug: 'whisky-indian',
    brandSlug: 'amrut',
    name: 'Amrut Fusion Indian Single Malt',
    productType: PRODUCT_TYPE.WHISKEY,
    alcoholPercentage: 50.0,
    originCountry: 'India',
    description: 'Barley from India and Scotland, matured in Bangalore. Smoke, honey and dried fruit.',
    variants: [
      { sku: 'AMRUT-FUS-700', sizeMl: 700, mrp: 4800.00, sellingPrice: 4550.00, taxPercent: 18, stock: 18, reorder: 6 },
    ],
  },
  {
    slug: 'beer-lager',
    brandSlug: 'kingfisher',
    name: 'Kingfisher Premium Lager',
    productType: PRODUCT_TYPE.BEER,
    alcoholPercentage: 4.8,
    originCountry: 'India',
    description: 'India\'s best-known lager. Crisp, light and built for the heat.',
    variants: [
      { sku: 'KF-PREM-650', sizeMl: 650, mrp: 160.00, sellingPrice: 150.00, taxPercent: 18, stock: 120, reorder: 24 },
      { sku: 'KF-PREM-330-6', sizeMl: 330, packSize: 6, mrp: 720.00, sellingPrice: 660.00, taxPercent: 18, stock: 40, reorder: 12 },
    ],
  },
  {
    slug: 'beer-craft-ipa',
    brandSlug: 'bira-91',
    name: 'Bira 91 White Ale',
    productType: PRODUCT_TYPE.BEER,
    alcoholPercentage: 4.7,
    originCountry: 'India',
    description: 'Cloudy wheat ale with coriander and orange peel. Low bitterness.',
    variants: [
      { sku: 'BIRA-WHITE-330', sizeMl: 330, mrp: 180.00, sellingPrice: 165.00, taxPercent: 18, stock: 96, reorder: 24 },
    ],
  },
  {
    slug: 'wine-red',
    brandSlug: 'sula-vineyards',
    name: 'Sula Rasa Cabernet Sauvignon',
    productType: PRODUCT_TYPE.WINE,
    alcoholPercentage: 13.5,
    originCountry: 'India',
    description: 'Nashik-grown cabernet, eighteen months in French oak. Blackcurrant and cedar.',
    variants: [
      { sku: 'SULA-RASA-750', sizeMl: 750, mrp: 2200.00, sellingPrice: 1999.00, taxPercent: 18, stock: 30, reorder: 8 },
    ],
  },
  {
    slug: 'vodka',
    brandSlug: 'absolut',
    name: 'Absolut Original Vodka',
    productType: PRODUCT_TYPE.VODKA,
    alcoholPercentage: 40.0,
    originCountry: 'Sweden',
    description: 'Continuously distilled winter wheat vodka from Ahus.',
    variants: [
      { sku: 'ABS-ORIG-750', sizeMl: 750, mrp: 2400.00, sellingPrice: 2250.00, taxPercent: 18, stock: 36, reorder: 10 },
    ],
  },
  {
    slug: 'rum',
    brandSlug: 'old-monk',
    name: 'Old Monk Supreme XXX Rum',
    productType: PRODUCT_TYPE.RUM,
    alcoholPercentage: 42.8,
    originCountry: 'India',
    description: 'Seven-year aged dark rum. Vanilla, caramel and a warm finish.',
    variants: [
      { sku: 'OM-SUP-750', sizeMl: 750, mrp: 1100.00, sellingPrice: 995.00, taxPercent: 18, stock: 60, reorder: 15 },
    ],
  },
  {
    slug: 'gin',
    brandSlug: 'greater-than',
    name: 'Greater Than London Dry Gin',
    productType: PRODUCT_TYPE.GIN,
    alcoholPercentage: 42.8,
    originCountry: 'India',
    description: 'India\'s first craft gin. Juniper, coriander, fennel and chamomile.',
    variants: [
      { sku: 'GT-LDG-750', sizeMl: 750, mrp: 1500.00, sellingPrice: 1399.00, taxPercent: 18, stock: 2, reorder: 8 },
    ],
  },
];

const COUPONS = [
  {
    code: 'CHEERS20',
    title: '20% off your first order',
    description: 'Twenty per cent off, up to 500, on orders over 1000.',
    discountType: DISCOUNT_TYPE.PERCENTAGE,
    discountValue: 20.00,
    maxDiscountAmount: 500.00,
    minOrderAmount: 1000.00,
    usageLimit: 1000,
    usageLimitPerUser: 1,
  },
  {
    code: 'FLAT200',
    title: 'Flat 200 off',
    description: 'Two hundred off any order over 1500.',
    discountType: DISCOUNT_TYPE.FIXED,
    discountValue: 200.00,
    maxDiscountAmount: null,
    minOrderAmount: 1500.00,
    usageLimit: null,
    usageLimitPerUser: 5,
  },
];

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const now = new Date();
    const { SELECT } = sequelize.QueryTypes;

    const one = async (sql, replacements) => {
      const rows = await sequelize.query(sql, { type: SELECT, replacements });
      return rows[0] || null;
    };

    const passwordHash = await bcrypt.hash(SAMPLE_PASSWORD, config.security.bcryptSaltRounds);

    /** Creates a user if absent and grants the role. Returns the user id. */
    const ensureUser = async (person, roleCode, extra = {}) => {
      let user = await one('SELECT id FROM users WHERE email = :email', { email: person.email });

      if (!user) {
        await queryInterface.bulkInsert('users', [{
          first_name: person.firstName,
          last_name: person.lastName,
          email: person.email,
          phone: person.phone,
          password_hash: passwordHash,
          date_of_birth: person.dateOfBirth || null,
          account_status: ACCOUNT_STATUS.ACTIVE,
          email_verified_at: now,
          login_attempts: 0,
          preferred_language: 'en',
          timezone: 'Asia/Kolkata',
          created_at: now,
          is_active: true,
          ...extra,
        }]);
        user = await one('SELECT id FROM users WHERE email = :email', { email: person.email });
      }

      const role = await one('SELECT id FROM roles WHERE code = :code', { code: roleCode });
      if (!role) throw new Error(`Role ${roleCode} is missing. Run the RBAC seeder first.`);

      const link = await one(
        'SELECT id FROM user_roles WHERE user_id = :userId AND role_id = :roleId',
        { userId: user.id, roleId: role.id }
      );

      if (!link) {
        await queryInterface.bulkInsert('user_roles', [{
          user_id: user.id,
          role_id: role.id,
          created_at: now,
          created_by: user.id,
          is_active: true,
        }]);
      }

      return user.id;
    };

    // ---------------------------------------------------------------------
    // 1. The store, its owner, its address and its excise licence
    // ---------------------------------------------------------------------
    const ownerId = await ensureUser(VENDOR_OWNER, ROLES.VENDOR_OWNER);

    let vendor = await one('SELECT id FROM vendors WHERE email = :email', {
      email: VENDOR_OWNER.email,
    });

    if (!vendor) {
      await queryInterface.bulkInsert('vendors', [{
        business_name: 'Jubilee Hills Wine Mart',
        legal_name: 'Jubilee Hills Beverages Pvt Ltd',
        owner_user_id: ownerId,
        email: VENDOR_OWNER.email,
        phone: '+914023551234',
        description: 'A licensed retailer in Jubilee Hills, Hyderabad. Single malts, craft beer and Indian wine.',
        status: VENDOR_STATUS.APPROVED,
        reviewed_by: ownerId,
        reviewed_at: now,
        rating_avg: 4.60,
        rating_count: 128,
        commission_percent: 12.50,
        delivery_radius_km: 8.00,
        min_order_amount: 500.00,
        created_at: now,
        created_by: ownerId,
        is_active: true,
      }]);

      vendor = await one('SELECT id FROM vendors WHERE email = :email', {
        email: VENDOR_OWNER.email,
      });

      await queryInterface.bulkInsert('vendor_users', [{
        vendor_id: vendor.id,
        user_id: ownerId,
        vendor_role: VENDOR_ROLE.OWNER,
        created_at: now,
        created_by: ownerId,
        is_active: true,
      }]);

      await queryInterface.bulkInsert('vendor_addresses', [{
        vendor_id: vendor.id,
        address_line1: 'Plot 402, Road No. 36',
        address_line2: 'Jubilee Hills',
        city: 'Hyderabad',
        state: 'Telangana',
        postal_code: '500033',
        country: 'India',
        region_code: 'IN-TS',
        latitude: 17.431700,
        longitude: 78.408500,
        is_primary: true,
        created_at: now,
        created_by: ownerId,
        is_active: true,
      }]);

      // The licence window is generated around today, so the sample store is
      // always currently licensed however long after seeding it is used.
      const validFrom = new Date(now.getFullYear() - 1, 3, 1);
      const validUntil = new Date(now.getFullYear() + 2, 2, 31);

      await queryInterface.bulkInsert('vendor_licenses', [{
        vendor_id: vendor.id,
        license_number: 'SAMPLE-TS-FL2-000417',
        license_type: 'FL-2 Retail (Sample)',
        issuing_authority: 'Telangana State Prohibition and Excise Department',
        region_code: 'IN-TS',
        valid_from: validFrom.toISOString().slice(0, 10),
        valid_until: validUntil.toISOString().slice(0, 10),
        status: VERIFICATION_STATUS.APPROVED,
        reviewed_by: ownerId,
        reviewed_at: now,
        created_at: now,
        created_by: ownerId,
        is_active: true,
      }]);
    }

    // ---------------------------------------------------------------------
    // 2. Products, variants and stock
    // ---------------------------------------------------------------------
    for (const entry of PRODUCTS) {
      const category = await one('SELECT id FROM categories WHERE slug = :slug', {
        slug: entry.slug,
      });
      if (!category) continue;

      const brand = await one('SELECT id FROM brands WHERE slug = :slug', {
        slug: entry.brandSlug,
      });

      const productSlug = entry.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');

      let product = await one(
        'SELECT id FROM products WHERE vendor_id = :vendorId AND slug = :slug',
        { vendorId: vendor.id, slug: productSlug }
      );

      if (!product) {
        await queryInterface.bulkInsert('products', [{
          vendor_id: vendor.id,
          category_id: category.id,
          brand_id: brand ? brand.id : null,
          name: entry.name,
          slug: productSlug,
          description: entry.description,
          alcohol_percentage: entry.alcoholPercentage,
          origin_country: entry.originCountry,
          product_type: entry.productType,
          status: PRODUCT_STATUS.ACTIVE,
          reviewed_by: ownerId,
          reviewed_at: now,
          is_featured: entry.productType === PRODUCT_TYPE.WHISKEY,
          rating_avg: 0,
          rating_count: 0,
          created_at: now,
          created_by: ownerId,
          is_active: true,
        }]);

        product = await one(
          'SELECT id FROM products WHERE vendor_id = :vendorId AND slug = :slug',
          { vendorId: vendor.id, slug: productSlug }
        );
      }

      for (const v of entry.variants) {
        const existing = await one('SELECT id FROM product_variants WHERE sku = :sku', {
          sku: v.sku,
        });
        if (existing) continue;

        await queryInterface.bulkInsert('product_variants', [{
          product_id: product.id,
          sku: v.sku,
          size_ml: v.sizeMl,
          pack_size: v.packSize || 1,
          mrp: v.mrp,
          selling_price: v.sellingPrice,
          tax_percent: v.taxPercent,
          currency: 'INR',
          status: VARIANT_STATUS.ACTIVE,
          created_at: now,
          created_by: ownerId,
          is_active: true,
        }]);

        const variant = await one('SELECT id FROM product_variants WHERE sku = :sku', {
          sku: v.sku,
        });

        // Every variant gets an inventory row, or it could never be sold.
        await queryInterface.bulkInsert('inventory', [{
          vendor_id: vendor.id,
          product_variant_id: variant.id,
          quantity_available: v.stock,
          quantity_reserved: 0,
          reorder_level: v.reorder,
          created_at: now,
          created_by: ownerId,
          is_active: true,
        }]);
      }
    }

    // ---------------------------------------------------------------------
    // 3. A verified customer with a Telangana delivery address
    // ---------------------------------------------------------------------
    const customerId = await ensureUser(CUSTOMER, ROLES.CUSTOMER);

    let profile = await one('SELECT id FROM customer_profiles WHERE user_id = :userId', {
      userId: customerId,
    });

    if (!profile) {
      await queryInterface.bulkInsert('customer_profiles', [{
        user_id: customerId,
        legal_first_name: CUSTOMER.firstName,
        legal_last_name: CUSTOMER.lastName,
        date_of_birth: CUSTOMER.dateOfBirth,
        gender: 'FEMALE',
        marketing_opt_in: true,
        // Checkout reads this flag; the matching approved verification row is
        // written just below so the two never disagree.
        age_verified: true,
        age_verified_at: now,
        created_at: now,
        created_by: customerId,
        is_active: true,
      }]);

      profile = await one('SELECT id FROM customer_profiles WHERE user_id = :userId', {
        userId: customerId,
      });

      await queryInterface.bulkInsert('customer_addresses', [{
        customer_id: profile.id,
        label: 'Home',
        recipient_name: `${CUSTOMER.firstName} ${CUSTOMER.lastName}`,
        phone: CUSTOMER.phone,
        address_line1: 'Flat 12B, Cyber Heights',
        address_line2: 'Hitech City',
        city: 'Hyderabad',
        state: 'Telangana',
        postal_code: '500081',
        country: 'India',
        region_code: 'IN-TS',
        latitude: 17.443500,
        longitude: 78.377200,
        is_default: true,
        delivery_instructions: 'Call on arrival. Photo ID will be shown at the door.',
        created_at: now,
        created_by: customerId,
        is_active: true,
      }]);

      const address = await one(
        'SELECT id FROM customer_addresses WHERE customer_id = :customerId ORDER BY id DESC LIMIT 1',
        { customerId: profile.id }
      );

      await sequelize.query(
        'UPDATE customer_profiles SET default_address_id = :addressId WHERE id = :id',
        { replacements: { addressId: address.id, id: profile.id } }
      );

      const twoYears = new Date(now);
      twoYears.setFullYear(twoYears.getFullYear() + 2);

      await queryInterface.bulkInsert('age_verifications', [{
        user_id: customerId,
        document_type: 'DRIVING_LICENSE',
        // A placeholder digest: the real column stores a keyed HMAC, never a
        // document number, and this sample has no real document behind it.
        document_number_hash: 'sample-not-a-real-document-hash',
        date_of_birth: CUSTOMER.dateOfBirth,
        status: VERIFICATION_STATUS.APPROVED,
        reviewed_by: customerId,
        reviewed_at: now,
        expires_at: twoYears,
        created_at: now,
        created_by: customerId,
        is_active: true,
      }]);
    }

    // ---------------------------------------------------------------------
    // 4. An active delivery partner
    // ---------------------------------------------------------------------
    const riderId = await ensureUser(DELIVERY_PARTNER, ROLES.DELIVERY_PARTNER);

    const partner = await one('SELECT id FROM delivery_partners WHERE user_id = :userId', {
      userId: riderId,
    });

    if (!partner) {
      await queryInterface.bulkInsert('delivery_partners', [{
        user_id: riderId,
        vehicle_type: VEHICLE_TYPE.BIKE,
        vehicle_number: 'TS09EZ4417',
        license_number: 'SAMPLE-DL-TS-2026-0417',
        status: DELIVERY_PARTNER_STATUS.ACTIVE,
        reviewed_by: riderId,
        reviewed_at: now,
        current_latitude: 17.437800,
        current_longitude: 78.395600,
        location_updated_at: now,
        rating_avg: 4.80,
        rating_count: 342,
        created_at: now,
        created_by: riderId,
        is_active: true,
      }]);
    }

    // ---------------------------------------------------------------------
    // 5. Working coupons
    // ---------------------------------------------------------------------
    const startsAt = new Date(now.getFullYear(), 0, 1);
    const endsAt = new Date(now.getFullYear() + 2, 11, 31);

    for (const coupon of COUPONS) {
      const existing = await one('SELECT id FROM coupons WHERE code = :code', {
        code: coupon.code,
      });
      if (existing) continue;

      await queryInterface.bulkInsert('coupons', [{
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        discount_type: coupon.discountType,
        discount_value: coupon.discountValue,
        max_discount_amount: coupon.maxDiscountAmount,
        min_order_amount: coupon.minOrderAmount,
        usage_limit: coupon.usageLimit,
        usage_limit_per_user: coupon.usageLimitPerUser,
        usage_count: 0,
        vendor_id: null,
        starts_at: startsAt,
        ends_at: endsAt,
        status: COUPON_STATUS.ACTIVE,
        created_at: now,
        is_active: true,
      }]);
    }

    /* eslint-disable no-console */
    console.log('');
    console.log('  Sample marketplace seeded');
    console.log(`    store    Jubilee Hills Wine Mart (APPROVED, licensed IN-TS)`);
    console.log(`    owner    ${VENDOR_OWNER.email}`);
    console.log(`    customer ${CUSTOMER.email}  (age verified, Telangana address)`);
    console.log(`    rider    ${DELIVERY_PARTNER.email}`);
    console.log(`    password ${SAMPLE_PASSWORD}   (all three)`);
    console.log(`    coupons  ${COUPONS.map((c) => c.code).join(', ')}`);
    console.log('');
    /* eslint-enable no-console */
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    const emails = [VENDOR_OWNER.email, CUSTOMER.email, DELIVERY_PARTNER.email];

    // Ordered so foreign keys are satisfied on the way out.
    await sequelize.query(
      `DELETE i FROM inventory i
       JOIN vendors v ON v.id = i.vendor_id
       WHERE v.email = :vendorEmail`,
      { replacements: { vendorEmail: VENDOR_OWNER.email } }
    );
    await sequelize.query(
      `DELETE pv FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       JOIN vendors v ON v.id = p.vendor_id
       WHERE v.email = :vendorEmail`,
      { replacements: { vendorEmail: VENDOR_OWNER.email } }
    );
    await sequelize.query(
      `DELETE p FROM products p
       JOIN vendors v ON v.id = p.vendor_id
       WHERE v.email = :vendorEmail`,
      { replacements: { vendorEmail: VENDOR_OWNER.email } }
    );

    await queryInterface.bulkDelete('coupons', { code: COUPONS.map((c) => c.code) });

    for (const table of ['vendor_licenses', 'vendor_addresses', 'vendor_users']) {
      // eslint-disable-next-line no-await-in-loop
      await sequelize.query(
        `DELETE t FROM ${table} t JOIN vendors v ON v.id = t.vendor_id WHERE v.email = :email`,
        { replacements: { email: VENDOR_OWNER.email } }
      );
    }
    await queryInterface.bulkDelete('vendors', { email: VENDOR_OWNER.email });

    await sequelize.query(
      'DELETE dp FROM delivery_partners dp JOIN users u ON u.id = dp.user_id WHERE u.email IN (:emails)',
      { replacements: { emails } }
    );
    await sequelize.query(
      'DELETE av FROM age_verifications av JOIN users u ON u.id = av.user_id WHERE u.email IN (:emails)',
      { replacements: { emails } }
    );
    await sequelize.query(
      `DELETE ca FROM customer_addresses ca
       JOIN customer_profiles cp ON cp.id = ca.customer_id
       JOIN users u ON u.id = cp.user_id WHERE u.email IN (:emails)`,
      { replacements: { emails } }
    );
    await sequelize.query(
      'UPDATE customer_profiles cp JOIN users u ON u.id = cp.user_id SET cp.default_address_id = NULL WHERE u.email IN (:emails)',
      { replacements: { emails } }
    );
    await sequelize.query(
      'DELETE cp FROM customer_profiles cp JOIN users u ON u.id = cp.user_id WHERE u.email IN (:emails)',
      { replacements: { emails } }
    );
    await sequelize.query(
      'DELETE ur FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.email IN (:emails)',
      { replacements: { emails } }
    );
    await queryInterface.bulkDelete('users', { email: emails });
  },
};
