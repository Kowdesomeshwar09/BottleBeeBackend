'use strict';

const {
  primaryKey, fk, money, auditColumns, tableOptions, applyAuditBehaviour, addCheck,
} = require('../utils/migrationColumns');
const { PRODUCT_TYPE, PRODUCT_STATUS, VARIANT_STATUS } = require('../config/constants');

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable(
      'categories',
      {
        id: primaryKey(Sequelize),
        parent_id: fk(Sequelize, { table: 'categories', allowNull: true, onDelete: 'SET NULL' }),
        name: { type: DataTypes.STRING(150), allowNull: false },
        slug: { type: DataTypes.STRING(180), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        image_url: { type: DataTypes.STRING(500), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('categories', ['slug'], { unique: true, name: 'uq_categories_slug' });
    await queryInterface.addIndex('categories', ['parent_id'], { name: 'idx_categories_parent' });
    await applyAuditBehaviour(queryInterface, 'categories');

    await queryInterface.createTable(
      'brands',
      {
        id: primaryKey(Sequelize),
        name: { type: DataTypes.STRING(150), allowNull: false },
        slug: { type: DataTypes.STRING(180), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        logo_url: { type: DataTypes.STRING(500), allowNull: true },
        country_of_origin: { type: DataTypes.STRING(100), allowNull: true },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('brands', ['slug'], { unique: true, name: 'uq_brands_slug' });
    await applyAuditBehaviour(queryInterface, 'brands');

    await queryInterface.createTable(
      'products',
      {
        id: primaryKey(Sequelize),
        vendor_id: fk(Sequelize, { table: 'vendors', onDelete: 'CASCADE' }),
        category_id: fk(Sequelize, { table: 'categories', onDelete: 'RESTRICT' }),
        brand_id: fk(Sequelize, { table: 'brands', allowNull: true, onDelete: 'SET NULL' }),
        name: { type: DataTypes.STRING(255), allowNull: false },
        slug: { type: DataTypes.STRING(280), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        alcohol_percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
        origin_country: { type: DataTypes.STRING(100), allowNull: true },
        product_type: { type: DataTypes.ENUM(...Object.values(PRODUCT_TYPE)), allowNull: false },
        status: {
          type: DataTypes.ENUM(...Object.values(PRODUCT_STATUS)),
          allowNull: false,
          defaultValue: PRODUCT_STATUS.DRAFT,
        },
        rejection_reason: { type: DataTypes.STRING(500), allowNull: true },
        reviewed_by: fk(Sequelize, { table: 'users', allowNull: true, onDelete: 'SET NULL' }),
        reviewed_at: { type: DataTypes.DATE, allowNull: true },
        is_featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        rating_avg: { type: DataTypes.DECIMAL(3, 2), allowNull: false, defaultValue: 0 },
        rating_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('products', ['vendor_id', 'slug'], {
      unique: true,
      name: 'uq_product_vendor_slug',
    });
    await queryInterface.addIndex('products', ['vendor_id', 'status'], {
      name: 'idx_products_vendor_status',
    });
    await queryInterface.addIndex('products', ['category_id'], { name: 'idx_products_category' });
    await queryInterface.addIndex('products', ['brand_id'], { name: 'idx_products_brand' });
    await queryInterface.addIndex('products', ['product_type'], { name: 'idx_products_type' });
    await applyAuditBehaviour(queryInterface, 'products');
    // Full-text search over name + description powers public catalog search.
    await queryInterface.sequelize.query(
      'ALTER TABLE `products` ADD FULLTEXT INDEX `ft_products_search` (`name`, `description`)'
    );
    await addCheck(
      queryInterface,
      'products',
      'chk_products_alcohol_percentage',
      'alcohol_percentage IS NULL OR (alcohol_percentage >= 0 AND alcohol_percentage <= 100)'
    );

    await queryInterface.createTable(
      'product_variants',
      {
        id: primaryKey(Sequelize),
        product_id: fk(Sequelize, { table: 'products', onDelete: 'CASCADE' }),
        sku: { type: DataTypes.STRING(120), allowNull: false },
        size_ml: { type: DataTypes.INTEGER, allowNull: false },
        pack_size: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        mrp: money(Sequelize),
        selling_price: money(Sequelize),
        tax_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
        currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
        barcode: { type: DataTypes.STRING(120), allowNull: true },
        weight_grams: { type: DataTypes.INTEGER, allowNull: true },
        status: {
          type: DataTypes.ENUM(...Object.values(VARIANT_STATUS)),
          allowNull: false,
          defaultValue: VARIANT_STATUS.ACTIVE,
        },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('product_variants', ['sku'], { unique: true, name: 'uq_variant_sku' });
    await queryInterface.addIndex('product_variants', ['product_id'], { name: 'idx_variants_product' });
    await applyAuditBehaviour(queryInterface, 'product_variants');
    await addCheck(queryInterface, 'product_variants', 'chk_variant_price_positive', 'selling_price >= 0');
    await addCheck(queryInterface, 'product_variants', 'chk_variant_mrp_gte_price', 'mrp >= selling_price');
    await addCheck(queryInterface, 'product_variants', 'chk_variant_size_positive', 'size_ml > 0');
    await addCheck(queryInterface, 'product_variants', 'chk_variant_pack_positive', 'pack_size > 0');

    await queryInterface.createTable(
      'product_images',
      {
        id: primaryKey(Sequelize),
        product_id: fk(Sequelize, { table: 'products', onDelete: 'CASCADE' }),
        image_url: { type: DataTypes.STRING(500), allowNull: false },
        alt_text: { type: DataTypes.STRING(255), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        is_primary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ...auditColumns(Sequelize),
      },
      tableOptions
    );
    await queryInterface.addIndex('product_images', ['product_id'], {
      name: 'idx_product_images_product',
    });
    await applyAuditBehaviour(queryInterface, 'product_images');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_images');
    await queryInterface.dropTable('product_variants');
    await queryInterface.dropTable('products');
    await queryInterface.dropTable('brands');
    await queryInterface.dropTable('categories');
  },
};
