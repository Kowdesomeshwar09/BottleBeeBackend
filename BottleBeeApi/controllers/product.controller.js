'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Product, ProductVariant, ProductImage, Category, Brand, Vendor,
  Inventory, VendorLicense, Review, User,
} = require('../models');
const {
  PRODUCT_STATUS, VARIANT_STATUS, VENDOR_STATUS, VENDOR_ROLE, VERIFICATION_STATUS,
  REVIEW_STATUS, AUDIT_ACTIONS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { uniqueSlug } = require('../utils/slug');
const { recordAudit } = require('../utils/audit');
const { toDateOnly } = require('../utils/dates');
const { publicUrl } = require('../middlewares/upload');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');
const vendorAccessService = require('../services/vendorAccess.service');
const notificationService = require('../services/notification.service');

/**
 * Products, variants, images — and the public storefront.
 *
 * Serves both `product.routes.js` (vendor and staff) and
 * `publicCatalog.routes.js` (unauthenticated browsing), the same way
 * `catalog.controller.js` serves both category and brand routes. Keeping them
 * together avoids duplicating the serializers and the visibility rules, which
 * are the two things that must not drift between the two surfaces.
 *
 * Publishing is deliberately two-step: a vendor moves a DRAFT to
 * PENDING_APPROVAL, and an admin with PRODUCT_APPROVE makes it ACTIVE. Only
 * ACTIVE products from APPROVED, licensed stores are ever publicly visible, so
 * nothing unreviewed can be bought.
 */

const SORTABLE = ['id', 'name', 'status', 'ratingAvg', 'isFeatured', 'createdAt', 'updatedAt'];
const PUBLIC_SORTABLE = ['name', 'ratingAvg', 'ratingCount', 'createdAt'];
const OWNER_OR_MANAGER = [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serializeVariant = (variant) => {
  const inv = variant.inventory;
  const mrp = Number(variant.mrp);
  const price = Number(variant.sellingPrice);

  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    sizeMl: variant.sizeMl,
    packSize: variant.packSize,
    label: typeof variant.label === 'function' ? variant.label() : null,
    mrp,
    sellingPrice: price,
    discountPercent: mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0,
    taxPercent: Number(variant.taxPercent || 0),
    currency: variant.currency,
    barcode: variant.barcode,
    weightGrams: variant.weightGrams,
    status: variant.status,
    isActive: variant.isActive,
    inventory: inv
      ? {
        quantityAvailable: inv.quantityAvailable,
        quantityReserved: inv.quantityReserved,
        reorderLevel: inv.reorderLevel,
        inStock: inv.quantityAvailable > 0,
      }
      : undefined,
  };
};

const serializeImage = (image) => ({
  id: image.id,
  productId: image.productId,
  imageUrl: image.imageUrl,
  altText: image.altText,
  sortOrder: image.sortOrder,
  isPrimary: image.isPrimary,
});

const serialize = (product, extra = {}) => ({
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
    ? {
      id: product.brand.id,
      name: product.brand.name,
      slug: product.brand.slug,
      logoUrl: product.brand.logoUrl,
    }
    : undefined,
  variants: product.variants ? product.variants.map(serializeVariant) : undefined,
  images: product.images ? product.images.map(serializeImage) : undefined,
  ...extra,
});

/** The include set used by every full product response. */
const productIncludes = [
  {
    model: Vendor,
    as: 'vendor',
    attributes: ['id', 'businessName', 'status', 'ratingAvg', 'ownerUserId'],
  },
  { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] },
  { model: Brand, as: 'brand', attributes: ['id', 'name', 'slug', 'logoUrl'], required: false },
  {
    model: ProductVariant,
    as: 'variants',
    required: false,
    include: [{ model: Inventory, as: 'inventory', required: false }],
  },
  { model: ProductImage, as: 'images', required: false },
];

const findProductWithRelations = (id) => Product.findByPk(id, {
  include: productIncludes,
  order: [
    [{ model: ProductVariant, as: 'variants' }, 'sizeMl', 'ASC'],
    [{ model: ProductImage, as: 'images' }, 'sortOrder', 'ASC'],
  ],
});

/** Confirms the caller may write to this product's store. */
const assertProductAccess = (product, req) => vendorAccessService.assertVendorAccess(
  product.vendorId,
  req,
  { requireRoles: OWNER_OR_MANAGER }
);

/**
 * Creates a variant plus its inventory row.
 * Shared by inline creation during `create` and the standalone variant endpoint,
 * so a variant is never left without somewhere to hold its stock.
 */
async function createVariantRecord(product, payload, actorId, transaction) {
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
      createdBy: actorId,
    },
    { transaction }
  );

  await Inventory.findOrCreate({
    where: { vendorId: product.vendorId, productVariantId: variant.id },
    defaults: {
      vendorId: product.vendorId,
      productVariantId: variant.id,
      quantityAvailable: payload.initialStock ?? 0,
      quantityReserved: 0,
      reorderLevel: payload.reorderLevel ?? 0,
      createdBy: actorId,
    },
    transaction,
  });

  return variant;
}

/**
 * The join that makes a product publicly visible: an APPROVED, active store.
 * When `regionCode` is supplied, the store must also hold a valid licence for
 * that region, so a customer never browses something checkout would refuse.
 */
function publicVendorInclude(regionCode) {
  const today = toDateOnly(new Date());

  return {
    model: Vendor,
    as: 'vendor',
    required: true,
    attributes: ['id', 'businessName', 'status', 'ratingAvg', 'ratingCount', 'minOrderAmount'],
    where: { status: VENDOR_STATUS.APPROVED, isActive: true },
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

/* ========================================================================== */
/*                        VENDOR-SIDE PRODUCT MANAGEMENT                      */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                             CREATE A PRODUCT                               */
/* -------------------------------------------------------------------------- */
const create = async (req, res) => {
  try {
    const vendorId = await vendorAccessService.resolveVendorId(req.body, req);
    await vendorAccessService.assertVendorAccess(vendorId, req, { requireRoles: OWNER_OR_MANAGER });

    const category = await Category.findByPk(req.body.categoryId);
    if (!category) return fail(res, 'Category does not exist', 400);

    if (req.body.brandId) {
      const brand = await Brand.findByPk(req.body.brandId);
      if (!brand) return fail(res, 'Brand does not exist', 400);
    }

    const product = await sequelize.transaction(async (transaction) => {
      const record = await Product.create(
        {
          vendorId,
          categoryId: req.body.categoryId,
          brandId: req.body.brandId || null,
          name: req.body.name,
          // Slug is unique per vendor, so two stores may both sell "Old Monk 750".
          slug: await uniqueSlug(Product, req.body.slug || req.body.name, {
            scope: { vendorId },
            transaction,
          }),
          description: req.body.description || null,
          alcoholPercentage: req.body.alcoholPercentage ?? null,
          originCountry: req.body.originCountry || null,
          productType: req.body.productType,
          status: PRODUCT_STATUS.DRAFT,
          createdBy: req.user.id,
        },
        { transaction }
      );

      if (req.body.variants?.length) {
        for (const variant of req.body.variants) {
          // eslint-disable-next-line no-await-in-loop
          await createVariantRecord(record, variant, req.user.id, transaction);
        }
      }

      return record;
    });

    const fresh = await findProductWithRelations(product.id);
    return created(res, serialize(fresh), 'Product created successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error creating product', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             UPDATE A PRODUCT                               */
/* -------------------------------------------------------------------------- */
const update = async (req, res) => {
  try {
    const product = await Product.findByPk(req.body.id);
    if (!product) return fail(res, 'Product not found', 404);
    await assertProductAccess(product, req);

    if (req.body.categoryId) {
      const category = await Category.findByPk(req.body.categoryId);
      if (!category) return fail(res, 'Category does not exist', 400);
    }
    if (req.body.brandId) {
      const brand = await Brand.findByPk(req.body.brandId);
      if (!brand) return fail(res, 'Brand does not exist', 400);
    }

    // A live listing that is edited materially goes back for review, so an
    // approved product cannot be quietly swapped for something else.
    const wasActive = product.status === PRODUCT_STATUS.ACTIVE;
    const materialEdit = req.body.name || req.body.description || req.body.productType;

    await product.update({
      categoryId: req.body.categoryId ?? product.categoryId,
      brandId: req.body.brandId === undefined ? product.brandId : req.body.brandId,
      name: req.body.name ?? product.name,
      slug: req.body.slug
        ? await uniqueSlug(Product, req.body.slug, {
          scope: { vendorId: product.vendorId },
          excludeId: product.id,
        })
        : product.slug,
      description: req.body.description ?? product.description,
      alcoholPercentage: req.body.alcoholPercentage ?? product.alcoholPercentage,
      originCountry: req.body.originCountry ?? product.originCountry,
      productType: req.body.productType ?? product.productType,
      isActive: req.body.isActive ?? product.isActive,
      status: wasActive && materialEdit ? PRODUCT_STATUS.PENDING_APPROVAL : product.status,
      updatedBy: req.user.id,
    });

    const fresh = await findProductWithRelations(product.id);
    return updated(res, serialize(fresh), 'Product updated successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error updating product', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                         SUBMIT A DRAFT FOR REVIEW                          */
/* -------------------------------------------------------------------------- */
const submitForApproval = async (req, res) => {
  try {
    const product = await Product.findByPk(req.body.id, {
      include: [{ model: ProductVariant, as: 'variants', required: false }],
    });
    if (!product) return fail(res, 'Product not found', 404);
    await assertProductAccess(product, req);

    const submittable = [PRODUCT_STATUS.DRAFT, PRODUCT_STATUS.REJECTED, PRODUCT_STATUS.INACTIVE];
    if (!submittable.includes(product.status)) {
      return fail(
        res,
        `A product in status ${product.status} cannot be submitted for approval`,
        409
      );
    }

    if (!product.variants?.length) {
      return fail(
        res,
        'Add at least one variant with a size and price before submitting',
        409
      );
    }

    await product.update({
      status: PRODUCT_STATUS.PENDING_APPROVAL,
      rejectionReason: null,
      updatedBy: req.user.id,
    });

    const fresh = await findProductWithRelations(product.id);
    return updated(res, serialize(fresh), 'Product submitted for approval');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error submitting product', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       APPROVE OR REJECT A PRODUCT                          */
/* -------------------------------------------------------------------------- */
const review = async (req, res) => {
  try {
    const product = await Product.findByPk(req.body.id, {
      include: [{
        model: Vendor,
        as: 'vendor',
        attributes: ['id', 'businessName', 'ownerUserId', 'status'],
      }],
    });
    if (!product) return fail(res, 'Product not found', 404);

    if (product.status !== PRODUCT_STATUS.PENDING_APPROVAL) {
      return fail(
        res,
        `Only a product awaiting approval can be reviewed (this one is ${product.status})`,
        409
      );
    }

    const approving = req.body.status === PRODUCT_STATUS.ACTIVE;

    if (!approving && !req.body.rejectionReason) {
      return fail(res, 'A rejection reason is required', 422, [
        { field: 'rejectionReason', message: 'Required when rejecting' },
      ]);
    }

    // Publishing a product for an unapproved store would put it on the
    // storefront with no licensed seller behind it.
    if (approving && product.vendor?.status !== VENDOR_STATUS.APPROVED) {
      return fail(res, 'This store is not approved, so its products cannot be published', 409);
    }

    const previous = product.status;

    await product.update({
      status: req.body.status,
      rejectionReason: approving ? null : req.body.rejectionReason,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      isFeatured: req.body.isFeatured ?? product.isFeatured,
      updatedBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.PRODUCT_REVIEWED,
      entityType: 'Product',
      entityId: product.id,
      oldValues: { status: previous },
      newValues: {
        status: req.body.status,
        rejectionReason: req.body.rejectionReason || null,
      },
      req,
    });

    if (product.vendor) {
      await notificationService.notify({
        userId: product.vendor.ownerUserId,
        templateCode: approving ? 'PRODUCT_APPROVED' : 'PRODUCT_REJECTED',
        title: approving ? 'Product published' : 'Product rejected',
        message: approving
          ? `${product.name} is now live on Bottle Bee.`
          : `${product.name} was not approved: ${req.body.rejectionReason}`,
        referenceType: 'Product',
        referenceId: product.id,
      });
    }

    const fresh = await findProductWithRelations(product.id);
    const verb = approving ? 'approved' : 'rejected';
    return updated(res, serialize(fresh), `Product ${verb} successfully`);
  } catch (error) {
    return fail(res, 'Error reviewing product', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                    LIST PRODUCTS INCLUDING DRAFTS                          */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.productType) where.productType = req.body.productType;
    if (req.body.categoryId) where.categoryId = req.body.categoryId;
    if (req.body.brandId) where.brandId = req.body.brandId;
    if (req.body.isFeatured !== undefined && req.body.isFeatured !== null) {
      where.isFeatured = req.body.isFeatured;
    }
    if (req.body.isActive !== undefined && req.body.isActive !== null) {
      where.isActive = req.body.isActive;
    }
    if (req.body.search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.body.search}%` } },
        { description: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    if (req.body.vendorId) {
      await vendorAccessService.assertVendorAccess(req.body.vendorId, req);
      where.vendorId = req.body.vendorId;
    } else if (!vendorAccessService.isStaff(req)) {
      const ids = await vendorAccessService.myVendorIds(req);
      if (!ids.length) {
        return paginated(res, [], { page, limit, total: 0 }, 'Products fetched successfully');
      }
      where.vendorId = { [Op.in]: ids };
    }

    const result = await Product.findAndCountAll({
      where,
      include: productIncludes,
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((p) => serialize(p)),
      toPageMeta(result, { page, limit }),
      'Products fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching products', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             GET ONE PRODUCT                                */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const product = await findProductWithRelations(req.body.id);
    if (!product) return fail(res, 'Product not found', 404);

    // A product that is not live may only be read by its own store or by staff.
    if (product.status !== PRODUCT_STATUS.ACTIVE) {
      await vendorAccessService.assertVendorAccess(product.vendorId, req);
    }

    return ok(res, serialize(product), 'Product fetched successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching product', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            DELETE A PRODUCT                                */
/* -------------------------------------------------------------------------- */
/** Soft delete. Variants go inactive with it, so nothing stays purchasable. */
const remove = async (req, res) => {
  try {
    const product = await Product.findByPk(req.body.id);
    if (!product) return fail(res, 'Product not found', 404);
    await assertProductAccess(product, req);

    await sequelize.transaction(async (transaction) => {
      await product.update(
        { status: PRODUCT_STATUS.INACTIVE, isActive: false, deletedBy: req.user.id },
        { transaction }
      );
      await ProductVariant.update(
        { status: VARIANT_STATUS.INACTIVE, isActive: false, updatedBy: req.user.id },
        { where: { productId: product.id }, transaction }
      );
      await product.destroy({ transaction });
    });

    return deleted(res, 'Product deleted successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error deleting product', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                  VARIANTS                                  */
/* ========================================================================== */

const createVariant = async (req, res) => {
  try {
    const product = await Product.findByPk(req.body.productId);
    if (!product) return fail(res, 'Product not found', 404);
    await assertProductAccess(product, req);

    const variant = await sequelize.transaction((transaction) =>
      createVariantRecord(product, req.body, req.user.id, transaction));

    return created(res, serializeVariant(variant), 'Variant created successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error creating variant', 500, [{ message: error.message }]);
  }
};

const updateVariant = async (req, res) => {
  try {
    const variant = await ProductVariant.findByPk(req.body.id, {
      include: [{ model: Product, as: 'product' }],
    });
    if (!variant) return fail(res, 'Variant not found', 404);
    if (!variant.product) return fail(res, 'Parent product not found', 404);
    await assertProductAccess(variant.product, req);

    const mrp = req.body.mrp ?? variant.mrp;
    const sellingPrice = req.body.sellingPrice ?? variant.sellingPrice;
    if (Number(mrp) < Number(sellingPrice)) {
      return fail(res, 'MRP cannot be lower than the selling price', 422, [
        { field: 'mrp', message: 'Must be greater than or equal to sellingPrice' },
      ]);
    }

    if (req.body.sku && String(req.body.sku).toUpperCase() !== variant.sku) {
      const clash = await ProductVariant.findOne({
        where: { sku: String(req.body.sku).toUpperCase(), id: { [Op.ne]: variant.id } },
        paranoid: false,
        attributes: ['id'],
      });
      if (clash) return fail(res, `SKU ${req.body.sku} is already in use`, 409);
    }

    await variant.update({
      sku: req.body.sku ?? variant.sku,
      sizeMl: req.body.sizeMl ?? variant.sizeMl,
      packSize: req.body.packSize ?? variant.packSize,
      mrp,
      sellingPrice,
      taxPercent: req.body.taxPercent ?? variant.taxPercent,
      currency: req.body.currency ?? variant.currency,
      barcode: req.body.barcode ?? variant.barcode,
      weightGrams: req.body.weightGrams ?? variant.weightGrams,
      status: req.body.status ?? variant.status,
      isActive: req.body.isActive ?? variant.isActive,
      updatedBy: req.user.id,
    });

    return updated(res, serializeVariant(variant), 'Variant updated successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error updating variant', 500, [{ message: error.message }]);
  }
};

const deleteVariant = async (req, res) => {
  try {
    const variant = await ProductVariant.findByPk(req.body.id, {
      include: [{ model: Product, as: 'product' }],
    });
    if (!variant) return fail(res, 'Variant not found', 404);
    await assertProductAccess(variant.product, req);

    // Reserved units belong to orders a customer is already waiting on.
    const inventory = await Inventory.findOne({ where: { productVariantId: variant.id } });
    if (inventory && inventory.quantityReserved > 0) {
      return fail(
        res,
        `${inventory.quantityReserved} unit(s) are reserved for open orders. Fulfil or cancel those first.`,
        409
      );
    }

    const remaining = await ProductVariant.count({
      where: { productId: variant.productId, id: { [Op.ne]: variant.id } },
    });
    if (remaining === 0 && variant.product.status === PRODUCT_STATUS.ACTIVE) {
      return fail(
        res,
        'This is the only variant of a live product. Deactivate the product instead of removing its last variant.',
        409
      );
    }

    await variant.update({
      status: VARIANT_STATUS.INACTIVE,
      isActive: false,
      deletedBy: req.user.id,
    });
    await variant.destroy();

    return deleted(res, 'Variant deleted successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error deleting variant', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                   IMAGES                                   */
/* ========================================================================== */

const addImages = async (req, res) => {
  try {
    const product = await Product.findByPk(req.body.productId);
    if (!product) return fail(res, 'Product not found', 404);
    await assertProductAccess(product, req);

    const uploaded = (req.files || []).map((file) => ({ url: publicUrl(file) }));
    const referenced = (req.body.imageUrls || []).map((url) => ({ url }));
    const urls = uploaded.length ? uploaded : referenced;

    if (!urls.length) return fail(res, 'Provide at least one image file or URL', 400);

    const existingCount = await ProductImage.count({ where: { productId: product.id } });

    const images = await sequelize.transaction(async (transaction) => {
      // Only the very first image on a product with none becomes primary.
      if (existingCount === 0) {
        await ProductImage.update(
          { isPrimary: false, updatedBy: req.user.id },
          { where: { productId: product.id, isPrimary: true }, transaction }
        );
      }

      return ProductImage.bulkCreate(
        urls.map((entry, index) => ({
          productId: product.id,
          imageUrl: entry.url,
          altText: req.body.altText || product.name,
          sortOrder: existingCount + index,
          isPrimary: existingCount === 0 && index === 0,
          createdBy: req.user.id,
        })),
        { transaction }
      );
    });

    return created(res, images.map(serializeImage), 'Images uploaded successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error uploading images', 500, [{ message: error.message }]);
  }
};

const setPrimaryImage = async (req, res) => {
  try {
    const image = await ProductImage.findByPk(req.body.id, {
      include: [{ model: Product, as: 'product' }],
    });
    if (!image) return fail(res, 'Image not found', 404);
    await assertProductAccess(image.product, req);

    await sequelize.transaction(async (transaction) => {
      await ProductImage.update(
        { isPrimary: false, updatedBy: req.user.id },
        { where: { productId: image.productId, isPrimary: true }, transaction }
      );
      await image.update({ isPrimary: true, updatedBy: req.user.id }, { transaction });
    });

    return updated(res, serializeImage(image), 'Primary image updated successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error setting primary image', 500, [{ message: error.message }]);
  }
};

const deleteImage = async (req, res) => {
  try {
    const image = await ProductImage.findByPk(req.body.id, {
      include: [{ model: Product, as: 'product' }],
    });
    if (!image) return fail(res, 'Image not found', 404);
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

    return deleted(res, 'Image deleted successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error deleting image', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                              PUBLIC STOREFRONT                             */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                    BROWSE, SEARCH AND FILTER PRODUCTS                      */
/* -------------------------------------------------------------------------- */
const publicList = async (req, res) => {
  try {
    const { page, limit, offset, sortBy, sortOrder } = buildPagination(req.body, {
      sortable: PUBLIC_SORTABLE,
      defaultSort: 'createdAt',
    });

    const where = { status: PRODUCT_STATUS.ACTIVE, isActive: true };

    if (req.body.productType) where.productType = req.body.productType;
    if (req.body.categoryId) where.categoryId = req.body.categoryId;
    if (req.body.brandId) where.brandId = { [Op.in]: [].concat(req.body.brandId) };
    if (req.body.vendorId) where.vendorId = req.body.vendorId;
    if (req.body.isFeatured) where.isFeatured = true;
    if (req.body.minRating) where.ratingAvg = { [Op.gte]: req.body.minRating };
    if (req.body.search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.body.search}%` } },
        { description: { [Op.like]: `%${req.body.search}%` } },
      ];
    }
    if (req.body.minAlcohol !== undefined && req.body.minAlcohol !== null) {
      where.alcoholPercentage = { ...(where.alcoholPercentage || {}), [Op.gte]: req.body.minAlcohol };
    }
    if (req.body.maxAlcohol !== undefined && req.body.maxAlcohol !== null) {
      where.alcoholPercentage = { ...(where.alcoholPercentage || {}), [Op.lte]: req.body.maxAlcohol };
    }

    // Price and bottle size are variant attributes, not product attributes.
    const variantWhere = { status: VARIANT_STATUS.ACTIVE, isActive: true };
    if (req.body.minPrice !== undefined && req.body.minPrice !== null) {
      variantWhere.sellingPrice = { ...(variantWhere.sellingPrice || {}), [Op.gte]: req.body.minPrice };
    }
    if (req.body.maxPrice !== undefined && req.body.maxPrice !== null) {
      variantWhere.sellingPrice = { ...(variantWhere.sellingPrice || {}), [Op.lte]: req.body.maxPrice };
    }
    if (req.body.sizeMl) variantWhere.sizeMl = { [Op.in]: [].concat(req.body.sizeMl) };

    // Sorting by price has to happen on the variant column, not the product.
    const order = req.body.sortBy === 'price'
      ? [[{ model: ProductVariant, as: 'variants' }, 'sellingPrice', sortOrder]]
      : [[sortBy, sortOrder]];

    const result = await Product.findAndCountAll({
      where,
      include: [
        publicVendorInclude(req.body.regionCode),
        { model: Category, as: 'category', attributes: ['id', 'name', 'slug'] },
        { model: Brand, as: 'brand', attributes: ['id', 'name', 'slug', 'logoUrl'], required: false },
        {
          model: ProductVariant,
          as: 'variants',
          required: true,
          where: variantWhere,
          include: [{
            model: Inventory,
            as: 'inventory',
            required: !!req.body.inStockOnly,
            ...(req.body.inStockOnly ? { where: { quantityAvailable: { [Op.gt]: 0 } } } : {}),
          }],
        },
        { model: ProductImage, as: 'images', required: false },
      ],
      limit,
      offset,
      order,
      distinct: true,
      subQuery: false,
    });

    return paginated(
      res,
      result.rows.map((p) => serialize(p)),
      toPageMeta(result, { page, limit }),
      'Products fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching products', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                      PUBLIC PRODUCT DETAIL + REVIEWS                       */
/* -------------------------------------------------------------------------- */
const publicDetail = async (req, res) => {
  try {
    const where = { status: PRODUCT_STATUS.ACTIVE, isActive: true };
    if (req.body.id) where.id = req.body.id;
    if (req.body.slug) where.slug = req.body.slug;
    if (req.body.vendorId) where.vendorId = req.body.vendorId;

    const product = await Product.findOne({
      where,
      include: [
        publicVendorInclude(req.body.regionCode),
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

    if (!product) return fail(res, 'Product not found or not available', 404);

    const reviews = await Review.findAll({
      where: { productId: product.id, status: REVIEW_STATUS.APPROVED, isActive: true },
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'DESC']],
      limit: 10,
    });

    return ok(
      res,
      serialize(product, {
        reviews: reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          title: r.title,
          comment: r.comment,
          createdAt: r.createdAt,
          // Only a first name is exposed publicly.
          reviewer: r.user ? r.user.firstName : 'Bottle Bee customer',
        })),
      }),
      'Product fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching product', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                           STOREFRONT FACETS                                */
/* -------------------------------------------------------------------------- */
/** Everything the sidebar needs in one call, scoped to what is actually buyable. */
const publicFilters = async (req, res) => {
  try {
    const [categories, brands, priceRange, types, sizes] = await Promise.all([
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
      ProductVariant.findAll({
        attributes: [[sequelize.fn('DISTINCT', sequelize.col('size_ml')), 'sizeMl']],
        where: { status: VARIANT_STATUS.ACTIVE, isActive: true },
        order: [['sizeMl', 'ASC']],
        raw: true,
      }),
    ]);

    return ok(
      res,
      {
        categories: categories.map((c) => ({
          id: c.id, name: c.name, slug: c.slug, parentId: c.parentId,
        })),
        brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
        productTypes: types.map((t) => ({ type: t.productType, count: Number(t.count) })),
        priceRange: {
          min: Number(priceRange?.minPrice || 0),
          max: Number(priceRange?.maxPrice || 0),
        },
        sizesMl: sizes.map((s) => Number(s.sizeMl)).filter(Boolean),
      },
      'Filters fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching filters', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          PUBLIC STORE PROFILE                              */
/* -------------------------------------------------------------------------- */
const publicVendorDetail = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({
      where: { id: req.body.id, status: VENDOR_STATUS.APPROVED, isActive: true },
      attributes: [
        'id', 'businessName', 'description', 'logoUrl', 'ratingAvg', 'ratingCount',
        'minOrderAmount', 'deliveryRadiusKm',
      ],
    });
    if (!vendor) return fail(res, 'Store not found or not available', 404);

    const productCount = await Product.count({
      where: { vendorId: vendor.id, status: PRODUCT_STATUS.ACTIVE, isActive: true },
    });

    return ok(
      res,
      {
        id: vendor.id,
        businessName: vendor.businessName,
        description: vendor.description,
        logoUrl: vendor.logoUrl,
        ratingAvg: Number(vendor.ratingAvg || 0),
        ratingCount: vendor.ratingCount,
        minOrderAmount: vendor.minOrderAmount === null ? null : Number(vendor.minOrderAmount),
        deliveryRadiusKm: vendor.deliveryRadiusKm === null ? null : Number(vendor.deliveryRadiusKm),
        productCount,
      },
      'Store fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching store', 500, [{ message: error.message }]);
  }
};

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
