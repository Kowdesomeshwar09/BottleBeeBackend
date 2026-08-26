'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Product, ProductVariant, ProductImage, Category, Brand, Vendor,
  Inventory, VendorLicense, Review, User,
} = require('../models');
const {
  PRODUCT_STATUS, VARIANT_STATUS, VENDOR_STATUS, VENDOR_ROLE, VERIFICATION_STATUS,
  REVIEW_STATUS, ROLES, AUDIT_ACTIONS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { uniqueSlug } = require('../utils/slug');
const { recordAudit } = require('../utils/audit');
const { toDateOnly } = require('../utils/dates');
const vendorAccessService = require('./vendorAccess.service');
const notificationService = require('./notification.service');

/**
 * Products, variants and images — plus the public catalog.
 *
 * A vendor owns its products. Publishing is a two-step flow: the vendor moves a
 * DRAFT to PENDING_APPROVAL, and an admin with PRODUCT_APPROVE moves it to
 * ACTIVE. Only ACTIVE products from APPROVED, licensed vendors are visible
 * publicly, so nothing unreviewed can ever be bought.
 */

const SORTABLE = ['id', 'name', 'status', 'ratingAvg', 'isFeatured', 'createdAt', 'updatedAt'];
const PUBLIC_SORTABLE = ['name', 'ratingAvg', 'ratingCount', 'createdAt'];

function serializeVariant(variant, inventory = null) {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    sizeMl: variant.sizeMl,
    packSize: variant.packSize,
    label: typeof variant.label === 'function' ? variant.label() : null,
    mrp: Number(variant.mrp),
    sellingPrice: Number(variant.sellingPrice),
    discountPercent: Number(variant.mrp) > 0
      ? Math.round(((Number(variant.mrp) - Number(variant.sellingPrice)) / Number(variant.mrp)) * 100)
      : 0,
    taxPercent: Number(variant.taxPercent || 0),
    currency: variant.currency,
    barcode: variant.barcode,
    weightGrams: variant.weightGrams,
    status: variant.status,
    isActive: variant.isActive,
    inventory: inventory
      ? {
        quantityAvailable: inventory.quantityAvailable,
        quantityReserved: inventory.quantityReserved,
        reorderLevel: inventory.reorderLevel,
        inStock: inventory.quantityAvailable > 0,
      }
      : (variant.inventory
        ? {
          quantityAvailable: variant.inventory.quantityAvailable,
          quantityReserved: variant.inventory.quantityReserved,
          reorderLevel: variant.inventory.reorderLevel,
          inStock: variant.inventory.quantityAvailable > 0,
        }
        : undefined),
  };
}

function serializeImage(image) {
  return {
    id: image.id,
    productId: image.productId,
    imageUrl: image.imageUrl,
    altText: image.altText,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
  };
}

function serialize(product, extra = {}) {
  return {
    id: product.id,
    vendorId: product.vendorId,
    categoryId: product.categoryId,
    brandId: product.brandId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    alcoholPercentage: product.alcoholPercentage === null ? null : Number(product.alcoholPercentage),
    originCountry: product.originCountry,
    productType: product.productType,
    status: product.status,
    rejectionReason: product.rejectionReason,
    reviewedBy: product.reviewedBy,
    reviewedAt: product.reviewedAt,
    isFeatured: product.isFeatured,
    ratingAvg: Number(product.ratingAvg || 0),
    ratingCount: product.ratingCount,
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    vendor: product.vendor
      ? {
        id: product.vendor.id,
        businessName: product.vendor.businessName,
        status: product.vendor.status,
        ratingAvg: Number(product.vendor.ratingAvg || 0),
      }
      : undefined,
    category: product.category
      ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
      : undefined,
    brand: product.brand
      ? { id: product.brand.id, name: product.brand.name, slug: product.brand.slug, logoUrl: product.brand.logoUrl }
      : undefined,
    variants: product.variants ? product.variants.map((v) => serializeVariant(v)) : undefined,
    images: product.images ? product.images.map(serializeImage) : undefined,
    ...extra,
  };
}

/** Confirms the caller may write to this product's vendor. */
async function assertProductAccess(product, req) {
  await vendorAccessService.assertVendorAccess(product.vendorId, req, {
    requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER],
  });
}

// ---------------------------------------------------------------------------
// Vendor-side product management
// ---------------------------------------------------------------------------

async function create(body, req) {
  const vendorId = await vendorAccessService.resolveVendorId(body, req);
  await vendorAccessService.assertVendorAccess(vendorId, req, {
    requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER],
  });

  const category = await Category.findByPk(body.categoryId);
  if (!category) throw AppError.badRequest('Category does not exist');

  if (body.brandId) {
    const brand = await Brand.findByPk(body.brandId);
    if (!brand) throw AppError.badRequest('Brand does not exist');
  }

  const product = await sequelize.transaction(async (transaction) => {
    const created = await Product.create(
      {
        vendorId,
        categoryId: body.categoryId,
        brandId: body.brandId || null,
        name: body.name,
        // Slug is unique per vendor, so two stores may both sell "Old Monk 750".
        slug: await uniqueSlug(Product, body.slug || body.name, {
          scope: { vendorId },
          transaction,
        }),
        description: body.description || null,
        alcoholPercentage: body.alcoholPercentage ?? null,
        originCountry: body.originCountry || null,
        productType: body.productType,
        status: PRODUCT_STATUS.DRAFT,
        createdBy: req.user.id,
      },
      { transaction }
    );

    // Variants may be supplied inline so a product can be created complete.
    if (body.variants?.length) {
      for (const variant of body.variants) {
        // eslint-disable-next-line no-await-in-loop
        await createVariantRecord(created, variant, req, transaction);
      }
    }

    return created;
  });

  return detail({ id: product.id }, req);
}

async function update(body, req) {
  const product = await Product.findByPk(body.id);
  if (!product) throw AppError.notFound('Product not found');
  await assertProductAccess(product, req);

  if (body.categoryId) {
    const category = await Category.findByPk(body.categoryId);
    if (!category) throw AppError.badRequest('Category does not exist');
  }
  if (body.brandId) {
    const brand = await Brand.findByPk(body.brandId);
    if (!brand) throw AppError.badRequest('Brand does not exist');
  }

  const wasActive = product.status === PRODUCT_STATUS.ACTIVE;

  await product.update({
    categoryId: body.categoryId ?? product.categoryId,
    brandId: body.brandId === undefined ? product.brandId : body.brandId,
    name: body.name ?? product.name,
    slug: body.slug
      ? await uniqueSlug(Product, body.slug, { scope: { vendorId: product.vendorId }, excludeId: product.id })
      : product.slug,
    description: body.description ?? product.description,
    alcoholPercentage: body.alcoholPercentage ?? product.alcoholPercentage,
    originCountry: body.originCountry ?? product.originCountry,
    productType: body.productType ?? product.productType,
    isActive: body.isActive ?? product.isActive,
    // A published product that is edited materially goes back for review, so an
    // approved listing cannot be quietly swapped for something else.
    status: wasActive && (body.name || body.description || body.productType)
      ? PRODUCT_STATUS.PENDING_APPROVAL
      : product.status,
    updatedBy: req.user.id,
  });

  return detail({ id: product.id }, req);
}

/** Vendor submits a draft for admin review. */
async function submitForApproval(body, req) {
  const product = await Product.findByPk(body.id, {
    include: [{ model: ProductVariant, as: 'variants', required: false }],
  });
  if (!product) throw AppError.notFound('Product not found');
  await assertProductAccess(product, req);

  if (![PRODUCT_STATUS.DRAFT, PRODUCT_STATUS.REJECTED, PRODUCT_STATUS.INACTIVE].includes(product.status)) {
    throw AppError.businessRule(`A product in status ${product.status} cannot be submitted for approval`);
  }

  if (!product.variants?.length) {
    throw AppError.businessRule('Add at least one variant with a size and price before submitting');
  }

  await product.update({
    status: PRODUCT_STATUS.PENDING_APPROVAL,
    rejectionReason: null,
    updatedBy: req.user.id,
  });

  return detail({ id: product.id }, req);
}

/** Admin approves or rejects a submission. */
async function review(body, req) {
  const product = await Product.findByPk(body.id, {
    include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'ownerUserId', 'status'] }],
  });
  if (!product) throw AppError.notFound('Product not found');

  if (product.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
    throw AppError.businessRule(
      `Only a product awaiting approval can be reviewed (this one is ${product.status})`
    );
  }

  const approving = body.status === PRODUCT_STATUS.ACTIVE;
  if (!approving && !body.rejectionReason) {
    throw AppError.validation('A rejection reason is required', [
      { field: 'rejectionReason', message: 'Required when rejecting' },
    ]);
  }

  if (approving && product.vendor?.status !== VENDOR_STATUS.APPROVED) {
    throw AppError.businessRule('This store is not approved, so its products cannot be published');
  }

  const previous = product.status;

  await product.update({
    status: body.status,
    rejectionReason: approving ? null : body.rejectionReason,
    reviewedBy: req.user.id,
    reviewedAt: new Date(),
    isFeatured: body.isFeatured ?? product.isFeatured,
    updatedBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.PRODUCT_REVIEWED,
    entityType: 'Product',
    entityId: product.id,
    oldValues: { status: previous },
    newValues: { status: body.status, rejectionReason: body.rejectionReason || null },
    req,
  });

  if (product.vendor) {
    await notificationService.notify({
      userId: product.vendor.ownerUserId,
      templateCode: approving ? 'PRODUCT_APPROVED' : 'PRODUCT_REJECTED',
      title: approving ? 'Product published' : 'Product rejected',
      message: approving
        ? `${product.name} is now live on Bottle Bee.`
        : `${product.name} was not approved: ${body.rejectionReason}`,
      referenceType: 'Product',
      referenceId: product.id,
    });
  }

  return detail({ id: product.id }, req);
}

/** Vendor-side or admin-side listing, including non-public statuses. */
async function list(body, req) {
  const { page, limit, offset, order } = buildPagination(body, { sortable: SORTABLE });

  const where = {};
  if (body.status) where.status = body.status;
  if (body.productType) where.productType = body.productType;
  if (body.categoryId) where.categoryId = body.categoryId;
  if (body.brandId) where.brandId = body.brandId;
  if (body.isFeatured !== undefined && body.isFeatured !== null) where.isFeatured = body.isFeatured;
  if (body.isActive !== undefined && body.isActive !== null) where.isActive = body.isActive;
  if (body.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${body.search}%` } },
      { description: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const isStaff = req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);

  if (body.vendorId) {
    await vendorAccessService.assertVendorAccess(body.vendorId, req);
    where.vendorId = body.vendorId;
  } else if (!isStaff) {
    const ids = await vendorAccessService.myVendorIds(req);
    if (!ids.length) return { rows: [], meta: { page, limit, total: 0 } };
    where.vendorId = { [Op.in]: ids };
  }

  const result = await Product.findAndCountAll({
    where,
    include: [
      { model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'status', 'ratingAvg'] },
      { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] },
      { model: Brand, as: 'brand', attributes: ['id', 'name', 'slug', 'logoUrl'], required: false },
      {
        model: ProductVariant,
        as: 'variants',
        required: false,
        include: [{ model: Inventory, as: 'inventory', required: false }],
      },
      { model: ProductImage, as: 'images', required: false },
    ],
    limit,
    offset,
    order,
    distinct: true,
  });

  return { rows: result.rows.map((p) => serialize(p)), meta: toPageMeta(result, { page, limit }) };
}

async function detail(body, req) {
  const product = await Product.findByPk(body.id, {
    include: [
      { model: Vendor, as: 'vendor', attributes: ['id', 'businessName', 'status', 'ratingAvg', 'ownerUserId'] },
      { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] },
      { model: Brand, as: 'brand', attributes: ['id', 'name', 'slug', 'logoUrl'], required: false },
      {
        model: ProductVariant,
        as: 'variants',
        required: false,
        include: [{ model: Inventory, as: 'inventory', required: false }],
      },
      { model: ProductImage, as: 'images', required: false },
    ],
    order: [
      [{ model: ProductVariant, as: 'variants' }, 'sizeMl', 'ASC'],
      [{ model: ProductImage, as: 'images' }, 'sortOrder', 'ASC'],
    ],
  });
  if (!product) throw AppError.notFound('Product not found');

  // A non-public product may only be read by its vendor or by staff.
  if (product.status !== PRODUCT_STATUS.ACTIVE) {
    await vendorAccessService.assertVendorAccess(product.vendorId, req);
  }

  return serialize(product);
}

async function remove(body, req) {
  const product = await Product.findByPk(body.id);
  if (!product) throw AppError.notFound('Product not found');
  await assertProductAccess(product, req);

  await sequelize.transaction(async (transaction) => {
    await product.update(
      { status: PRODUCT_STATUS.INACTIVE, isActive: false, deletedBy: req.user.id },
      { transaction }
    );
    // Variants go inactive with the product so nothing remains purchasable.
    await ProductVariant.update(
      { status: VARIANT_STATUS.INACTIVE, isActive: false, updatedBy: req.user.id },
      { where: { productId: product.id }, transaction }
    );
    await product.destroy({ transaction });
  });

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** Shared by inline creation and the standalone endpoint. */
async function createVariantRecord(product, payload, req, transaction) {
  const clash = await ProductVariant.findOne({
    where: { sku: String(payload.sku).toUpperCase() },
    paranoid: false,
    transaction,
    attributes: ['id'],
  });
  if (clash) {
    throw AppError.conflict(`SKU ${payload.sku} is already in use`, [
      { field: 'sku', message: 'SKUs must be unique platform-wide' },
    ]);
  }

  if (Number(payload.mrp) < Number(payload.sellingPrice)) {
    throw AppError.validation('MRP cannot be lower than the selling price', [
      { field: 'mrp', message: 'Must be greater than or equal to sellingPrice' },
    ]);
  }

  const variant = await ProductVariant.create(
    {
      productId: product.id,
      sku: payload.sku,
      sizeMl: payload.sizeMl,
      packSize: payload.packSize ?? 1,
      mrp: payload.mrp,
      sellingPrice: payload.sellingPrice,
      taxPercent: payload.taxPercent ?? 0,
      currency: payload.currency || 'INR',
      barcode: payload.barcode || null,
      weightGrams: payload.weightGrams ?? null,
      status: VARIANT_STATUS.ACTIVE,
      createdBy: req.user.id,
    },
    { transaction }
  );

  // Every variant gets an inventory row immediately, so stock can be adjusted
  // without a separate "create inventory" step.
  await Inventory.findOrCreate({
    where: { vendorId: product.vendorId, productVariantId: variant.id },
    defaults: {
      vendorId: product.vendorId,
      productVariantId: variant.id,
      quantityAvailable: payload.initialStock ?? 0,
      quantityReserved: 0,
      reorderLevel: payload.reorderLevel ?? 0,
      createdBy: req.user.id,
    },
    transaction,
  });

  return variant;
}

async function createVariant(body, req) {
  const product = await Product.findByPk(body.productId);
  if (!product) throw AppError.notFound('Product not found');
  await assertProductAccess(product, req);

  const variant = await sequelize.transaction((transaction) =>
    createVariantRecord(product, body, req, transaction));

  return serializeVariant(variant);
}

async function updateVariant(body, req) {
  const variant = await ProductVariant.findByPk(body.id, {
    include: [{ model: Product, as: 'product' }],
  });
  if (!variant) throw AppError.notFound('Variant not found');
  if (!variant.product) throw AppError.notFound('Parent product not found');
  await assertProductAccess(variant.product, req);

  const mrp = body.mrp ?? variant.mrp;
  const sellingPrice = body.sellingPrice ?? variant.sellingPrice;
  if (Number(mrp) < Number(sellingPrice)) {
    throw AppError.validation('MRP cannot be lower than the selling price', [
      { field: 'mrp', message: 'Must be greater than or equal to sellingPrice' },
    ]);
  }

  if (body.sku && String(body.sku).toUpperCase() !== variant.sku) {
    const clash = await ProductVariant.findOne({
      where: { sku: String(body.sku).toUpperCase(), id: { [Op.ne]: variant.id } },
      paranoid: false,
      attributes: ['id'],
    });
    if (clash) throw AppError.conflict(`SKU ${body.sku} is already in use`);
  }

  await variant.update({
    sku: body.sku ?? variant.sku,
    sizeMl: body.sizeMl ?? variant.sizeMl,
    packSize: body.packSize ?? variant.packSize,
    mrp,
    sellingPrice,
    taxPercent: body.taxPercent ?? variant.taxPercent,
    currency: body.currency ?? variant.currency,
    barcode: body.barcode ?? variant.barcode,
    weightGrams: body.weightGrams ?? variant.weightGrams,
    status: body.status ?? variant.status,
    isActive: body.isActive ?? variant.isActive,
    updatedBy: req.user.id,
  });

  return serializeVariant(variant);
}

async function deleteVariant(body, req) {
  const variant = await ProductVariant.findByPk(body.id, {
    include: [{ model: Product, as: 'product' }],
  });
  if (!variant) throw AppError.notFound('Variant not found');
  await assertProductAccess(variant.product, req);

  const inventory = await Inventory.findOne({ where: { productVariantId: variant.id } });
  if (inventory && inventory.quantityReserved > 0) {
    throw AppError.conflict(
      `${inventory.quantityReserved} unit(s) are reserved for open orders. Fulfil or cancel those first.`
    );
  }

  const remaining = await ProductVariant.count({
    where: { productId: variant.productId, id: { [Op.ne]: variant.id } },
  });
  if (remaining === 0 && variant.product.status === PRODUCT_STATUS.ACTIVE) {
    throw AppError.conflict(
      'This is the only variant of a live product. Deactivate the product instead of removing its last variant.'
    );
  }

  await variant.update({ status: VARIANT_STATUS.INACTIVE, isActive: false, deletedBy: req.user.id });
  await variant.destroy();

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function addImages(body, files, req) {
  const product = await Product.findByPk(body.productId);
  if (!product) throw AppError.notFound('Product not found');
  await assertProductAccess(product, req);

  const urls = files?.length ? files : (body.imageUrls || []).map((url) => ({ url }));
  if (!urls.length) throw AppError.badRequest('Provide at least one image file or URL');

  const existingCount = await ProductImage.count({ where: { productId: product.id } });

  const created = await sequelize.transaction(async (transaction) => {
    const rows = [];
    for (let i = 0; i < urls.length; i += 1) {
      const isPrimary = existingCount === 0 && i === 0;
      if (isPrimary) {
        // eslint-disable-next-line no-await-in-loop
        await ProductImage.update(
          { isPrimary: false, updatedBy: req.user.id },
          { where: { productId: product.id, isPrimary: true }, transaction }
        );
      }
      rows.push({
        productId: product.id,
        imageUrl: urls[i].url,
        altText: body.altText || product.name,
        sortOrder: existingCount + i,
        isPrimary,
        createdBy: req.user.id,
      });
    }
    return ProductImage.bulkCreate(rows, { transaction });
  });

  return created.map(serializeImage);
}

async function setPrimaryImage(body, req) {
  const image = await ProductImage.findByPk(body.id, {
    include: [{ model: Product, as: 'product' }],
  });
  if (!image) throw AppError.notFound('Image not found');
  await assertProductAccess(image.product, req);

  await sequelize.transaction(async (transaction) => {
    await ProductImage.update(
      { isPrimary: false, updatedBy: req.user.id },
      { where: { productId: image.productId, isPrimary: true }, transaction }
    );
    await image.update({ isPrimary: true, updatedBy: req.user.id }, { transaction });
  });

  return serializeImage(image);
}

async function deleteImage(body, req) {
  const image = await ProductImage.findByPk(body.id, {
    include: [{ model: Product, as: 'product' }],
  });
  if (!image) throw AppError.notFound('Image not found');
  await assertProductAccess(image.product, req);

  await sequelize.transaction(async (transaction) => {
    await image.update({ deletedBy: req.user.id }, { transaction });
    await image.destroy({ transaction });

    // Promote another image so a product is never left without a primary.
    if (image.isPrimary) {
      const replacement = await ProductImage.findOne({
        where: { productId: image.productId },
        order: [['sortOrder', 'ASC']],
        transaction,
      });
      if (replacement) {
        await replacement.update({ isPrimary: true, updatedBy: req.user.id }, { transaction });
      }
    }
  });

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Public catalog
// ---------------------------------------------------------------------------

/**
 * The `where` and `include` that make a product publicly visible: ACTIVE
 * product, APPROVED and active vendor, and at least one purchasable variant.
 */
function publicVendorInclude(regionCode) {
  const today = toDateOnly(new Date());

  return {
    model: Vendor,
    as: 'vendor',
    required: true,
    attributes: ['id', 'businessName', 'status', 'ratingAvg', 'ratingCount', 'minOrderAmount'],
    where: { status: VENDOR_STATUS.APPROVED, isActive: true },
    // When a region is supplied, only stores licensed for it are shown, so a
    // customer never browses products that checkout would refuse.
    include: regionCode
      ? [{
        model: VendorLicense,
        as: 'licenses',
        required: true,
        attributes: ['id', 'regionCode', 'validUntil'],
        where: {
          status: VERIFICATION_STATUS.APPROVED,
          isActive: true,
          regionCode: String(regionCode).toUpperCase(),
          validFrom: { [Op.lte]: today },
          validUntil: { [Op.gte]: today },
        },
      }]
      : [],
  };
}

/** Public product search, filtering and sorting. */
async function publicList(body) {
  const { page, limit, offset, sortBy, sortOrder } = buildPagination(body, {
    sortable: PUBLIC_SORTABLE,
    defaultSort: 'createdAt',
  });

  const where = { status: PRODUCT_STATUS.ACTIVE, isActive: true };

  if (body.productType) where.productType = body.productType;
  if (body.categoryId) where.categoryId = body.categoryId;
  if (body.brandId) where.brandId = { [Op.in]: [].concat(body.brandId) };
  if (body.vendorId) where.vendorId = body.vendorId;
  if (body.isFeatured) where.isFeatured = true;
  if (body.minRating) where.ratingAvg = { [Op.gte]: body.minRating };
  if (body.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${body.search}%` } },
      { description: { [Op.like]: `%${body.search}%` } },
    ];
  }

  // Price and alcohol-strength filters apply to the variant, not the product.
  const variantWhere = { status: VARIANT_STATUS.ACTIVE, isActive: true };
  if (body.minPrice !== undefined && body.minPrice !== null) {
    variantWhere.sellingPrice = { ...(variantWhere.sellingPrice || {}), [Op.gte]: body.minPrice };
  }
  if (body.maxPrice !== undefined && body.maxPrice !== null) {
    variantWhere.sellingPrice = { ...(variantWhere.sellingPrice || {}), [Op.lte]: body.maxPrice };
  }
  if (body.sizeMl) variantWhere.sizeMl = { [Op.in]: [].concat(body.sizeMl) };

  if (body.minAlcohol !== undefined && body.minAlcohol !== null) {
    where.alcoholPercentage = { ...(where.alcoholPercentage || {}), [Op.gte]: body.minAlcohol };
  }
  if (body.maxAlcohol !== undefined && body.maxAlcohol !== null) {
    where.alcoholPercentage = { ...(where.alcoholPercentage || {}), [Op.lte]: body.maxAlcohol };
  }

  const variantInclude = {
    model: ProductVariant,
    as: 'variants',
    required: true,
    where: variantWhere,
    include: [{
      model: Inventory,
      as: 'inventory',
      required: !!body.inStockOnly,
      ...(body.inStockOnly ? { where: { quantityAvailable: { [Op.gt]: 0 } } } : {}),
    }],
  };

  // Price sorting has to happen on the variant column, not on products.
  const order = body.sortBy === 'price'
    ? [[{ model: ProductVariant, as: 'variants' }, 'sellingPrice', sortOrder]]
    : [[sortBy, sortOrder]];

  const result = await Product.findAndCountAll({
    where,
    include: [
      publicVendorInclude(body.regionCode),
      { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] },
      { model: Brand, as: 'brand', attributes: ['id', 'name', 'slug', 'logoUrl'], required: false },
      variantInclude,
      { model: ProductImage, as: 'images', required: false },
    ],
    limit,
    offset,
    order,
    distinct: true,
    subQuery: false,
  });

  return { rows: result.rows.map((p) => serialize(p)), meta: toPageMeta(result, { page, limit }) };
}

/** Public product detail by id or vendor-scoped slug, with approved reviews. */
async function publicDetail(body) {
  const where = { status: PRODUCT_STATUS.ACTIVE, isActive: true };
  if (body.id) where.id = body.id;
  if (body.slug) where.slug = body.slug;
  if (body.vendorId) where.vendorId = body.vendorId;

  const product = await Product.findOne({
    where,
    include: [
      publicVendorInclude(body.regionCode),
      { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] },
      { model: Brand, as: 'brand', attributes: ['id', 'name', 'slug', 'logoUrl'], required: false },
      {
        model: ProductVariant,
        as: 'variants',
        required: false,
        where: { status: VARIANT_STATUS.ACTIVE, isActive: true },
        include: [{ model: Inventory, as: 'inventory', required: false }],
      },
      { model: ProductImage, as: 'images', required: false },
    ],
    order: [
      [{ model: ProductVariant, as: 'variants' }, 'sizeMl', 'ASC'],
      [{ model: ProductImage, as: 'images' }, 'sortOrder', 'ASC'],
    ],
  });

  if (!product) throw AppError.notFound('Product not found or not available');

  const reviews = await Review.findAll({
    where: { productId: product.id, status: REVIEW_STATUS.APPROVED, isActive: true },
    include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] }],
    order: [['createdAt', 'DESC']],
    limit: 10,
  });

  return serialize(product, {
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      createdAt: r.createdAt,
      // Only the first name is exposed publicly.
      reviewer: r.user ? r.user.firstName : 'Bottle Bee customer',
    })),
  });
}

/** Filter facets for the storefront sidebar, scoped to what is actually buyable. */
async function publicFilters(body) {
  const [categories, brands, priceRange, types] = await Promise.all([
    Category.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'slug', 'parentId'],
      order: [['sortOrder', 'ASC']],
    }),
    Brand.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'slug'],
      order: [['name', 'ASC']],
    }),
    ProductVariant.findOne({
      attributes: [
        [sequelize.fn('MIN', sequelize.col('selling_price')), 'minPrice'],
        [sequelize.fn('MAX', sequelize.col('selling_price')), 'maxPrice'],
      ],
      where: { status: VARIANT_STATUS.ACTIVE, isActive: true },
      raw: true,
    }),
    Product.findAll({
      attributes: ['productType', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      where: { status: PRODUCT_STATUS.ACTIVE, isActive: true },
      group: ['productType'],
      raw: true,
    }),
  ]);

  const sizes = await ProductVariant.findAll({
    attributes: [[sequelize.fn('DISTINCT', sequelize.col('size_ml')), 'sizeMl']],
    where: { status: VARIANT_STATUS.ACTIVE, isActive: true },
    order: [['sizeMl', 'ASC']],
    raw: true,
  });

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId })),
    brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
    productTypes: types.map((t) => ({ type: t.productType, count: Number(t.count) })),
    priceRange: {
      min: Number(priceRange?.minPrice || 0),
      max: Number(priceRange?.maxPrice || 0),
    },
    sizesMl: sizes.map((s) => Number(s.sizeMl)).filter(Boolean),
  };
}

/** Public storefront for one vendor. */
async function publicVendorDetail(body) {
  const vendor = await Vendor.findOne({
    where: { id: body.id, status: VENDOR_STATUS.APPROVED, isActive: true },
    attributes: [
      'id', 'businessName', 'description', 'logoUrl', 'ratingAvg', 'ratingCount',
      'minOrderAmount', 'deliveryRadiusKm',
    ],
  });
  if (!vendor) throw AppError.notFound('Store not found or not available');

  const productCount = await Product.count({
    where: { vendorId: vendor.id, status: PRODUCT_STATUS.ACTIVE, isActive: true },
  });

  return {
    id: vendor.id,
    businessName: vendor.businessName,
    description: vendor.description,
    logoUrl: vendor.logoUrl,
    ratingAvg: Number(vendor.ratingAvg || 0),
    ratingCount: vendor.ratingCount,
    minOrderAmount: vendor.minOrderAmount === null ? null : Number(vendor.minOrderAmount),
    deliveryRadiusKm: vendor.deliveryRadiusKm === null ? null : Number(vendor.deliveryRadiusKm),
    productCount,
  };
}

module.exports = {
  create,
  update,
  submitForApproval,
  review,
  list,
  detail,
  remove,
  createVariant,
  updateVariant,
  deleteVariant,
  addImages,
  setPrimaryImage,
  deleteImage,
  publicList,
  publicDetail,
  publicFilters,
  publicVendorDetail,
  serialize,
  serializeVariant,
  serializeImage,
};
