'use strict';

const {
  Joi, requiredId, id, name, longText, url, money, percent, shortText, regionCode,
  enumOf, listSchema,
} = require('./common');
const { PRODUCT_TYPE, PRODUCT_STATUS, VARIANT_STATUS } = require('../config/constants');

const sku = Joi.string().trim().uppercase().pattern(/^[A-Z0-9][A-Z0-9._-]{2,119}$/)
  .messages({ 'string.pattern.base': 'SKU may contain only A-Z, 0-9, dot, dash and underscore' });

const variantFields = {
  sku: sku.required(),
  sizeMl: Joi.number().integer().min(1).max(100000).required(),
  packSize: Joi.number().integer().min(1).max(100).default(1),
  mrp: money.required(),
  sellingPrice: money.required(),
  taxPercent: percent.default(0),
  currency: Joi.string().trim().uppercase().length(3).default('INR'),
  barcode: Joi.string().trim().max(120).allow('', null),
  weightGrams: Joi.number().integer().min(0).max(1000000).allow(null),
  initialStock: Joi.number().integer().min(0).max(1000000).default(0),
  reorderLevel: Joi.number().integer().min(0).max(100000).default(0),
};

const createProductSchema = Joi.object({
  vendorId: id,
  categoryId: requiredId('categoryId'),
  brandId: id.allow(null),
  name: name(255).required(),
  slug: Joi.string().trim().lowercase().max(280),
  description: longText,
  alcoholPercentage: Joi.number().precision(2).min(0).max(100).allow(null),
  originCountry: name(100).allow('', null),
  productType: enumOf(PRODUCT_TYPE, 'productType').required(),
  // Variants may be supplied inline so a listing can be created complete.
  variants: Joi.array().items(Joi.object(variantFields)).max(20),
});

const updateProductSchema = Joi.object({
  id: requiredId(),
  categoryId: id,
  brandId: id.allow(null),
  name: name(255),
  slug: Joi.string().trim().lowercase().max(280),
  description: longText,
  alcoholPercentage: Joi.number().precision(2).min(0).max(100).allow(null),
  originCountry: name(100).allow('', null),
  productType: enumOf(PRODUCT_TYPE, 'productType'),
  isActive: Joi.boolean(),
}).min(2);

const listProductsSchema = listSchema({
  vendorId: id,
  categoryId: id,
  brandId: id,
  status: enumOf(PRODUCT_STATUS, 'status'),
  productType: enumOf(PRODUCT_TYPE, 'productType'),
  isFeatured: Joi.boolean(),
  isActive: Joi.boolean(),
});

const reviewProductSchema = Joi.object({
  id: requiredId(),
  status: Joi.string()
    .trim()
    .uppercase()
    .valid(PRODUCT_STATUS.ACTIVE, PRODUCT_STATUS.REJECTED)
    .required(),
  rejectionReason: shortText(500).when('status', {
    is: PRODUCT_STATUS.REJECTED,
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional().allow('', null),
  }),
  isFeatured: Joi.boolean(),
});

const createVariantSchema = Joi.object({
  productId: requiredId('productId'),
  ...variantFields,
});

const updateVariantSchema = Joi.object({
  id: requiredId(),
  sku,
  sizeMl: Joi.number().integer().min(1).max(100000),
  packSize: Joi.number().integer().min(1).max(100),
  mrp: money,
  sellingPrice: money,
  taxPercent: percent,
  currency: Joi.string().trim().uppercase().length(3),
  barcode: Joi.string().trim().max(120).allow('', null),
  weightGrams: Joi.number().integer().min(0).max(1000000).allow(null),
  status: enumOf(VARIANT_STATUS, 'status'),
  isActive: Joi.boolean(),
}).min(2);

/**
 * Backfill scope. Every field narrows what is touched; with none, it walks the
 * caller's whole catalogue up to `limit`.
 */
const backfillImagesSchema = Joi.object({
  id,
  vendorId: id,
  productType: enumOf(PRODUCT_TYPE, 'productType'),
  status: enumOf(PRODUCT_STATUS, 'status'),
  limit: Joi.number().integer().min(1).max(200).default(50),
  // Off by default: a store that photographed its own stock has supplied
  // something better than a category image, and a backfill must not trample it.
  replaceExisting: Joi.boolean().default(false),
});

const addImagesSchema = Joi.object({
  productId: requiredId('productId'),
  altText: Joi.string().trim().max(255).allow('', null),
  // Either upload files, or reference already-hosted URLs.
  imageUrls: Joi.array().items(Joi.string().trim().max(500)).max(10),
});

// --- Public catalog ---------------------------------------------------------

const publicListSchema = listSchema({
  categoryId: id,
  brandId: Joi.alternatives().try(id, Joi.array().items(id).max(20)),
  vendorId: id,
  productType: enumOf(PRODUCT_TYPE, 'productType'),
  minPrice: money,
  maxPrice: money,
  sizeMl: Joi.alternatives().try(
    Joi.number().integer().min(1),
    Joi.array().items(Joi.number().integer().min(1)).max(20)
  ),
  minAlcohol: Joi.number().precision(2).min(0).max(100),
  maxAlcohol: Joi.number().precision(2).min(0).max(100),
  minRating: Joi.number().min(0).max(5),
  isFeatured: Joi.boolean(),
  inStockOnly: Joi.boolean().default(false),
  // Restricts results to stores licensed for this region.
  regionCode: regionCode.allow('', null),
  sortBy: Joi.string().trim().valid('name', 'price', 'ratingAvg', 'ratingCount', 'createdAt'),
});

const publicDetailSchema = Joi.object({
  id,
  slug: Joi.string().trim().lowercase().max(280),
  vendorId: id,
  regionCode: regionCode.allow('', null),
}).or('id', 'slug');

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  reviewProductSchema,
  createVariantSchema,
  updateVariantSchema,
  addImagesSchema,
  backfillImagesSchema,
  publicListSchema,
  publicDetailSchema,
  idSchema,
  emptySchema,
};
