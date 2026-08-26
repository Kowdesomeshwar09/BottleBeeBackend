'use strict';

const { Op } = require('sequelize');

const { Category, Brand, Product } = require('../models');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { uniqueSlug } = require('../utils/slug');

/**
 * Categories and brands.
 *
 * Both are platform-owned reference data, not vendor-owned: a vendor picks from
 * them when publishing a product. Deletion is refused while products still
 * reference the row, so the catalog can never point at a missing category.
 */

const CATEGORY_SORTABLE = ['id', 'name', 'slug', 'sortOrder', 'createdAt'];
const BRAND_SORTABLE = ['id', 'name', 'slug', 'countryOfOrigin', 'createdAt'];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function serializeCategory(category, extra = {}) {
  return {
    id: category.id,
    parentId: category.parentId,
    name: category.name,
    slug: category.slug,
    description: category.description,
    imageUrl: category.imageUrl,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    parent: category.parent
      ? { id: category.parent.id, name: category.parent.name, slug: category.parent.slug }
      : undefined,
    children: category.children
      ? category.children.map((c) => serializeCategory(c))
      : undefined,
    ...extra,
  };
}

async function listCategories(body) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: CATEGORY_SORTABLE,
    defaultSort: 'sortOrder',
    defaultOrder: 'ASC',
  });

  const where = {};
  if (body.parentId !== undefined && body.parentId !== null) where.parentId = body.parentId;
  if (body.topLevelOnly) where.parentId = null;
  if (body.isActive !== undefined && body.isActive !== null) where.isActive = body.isActive;
  if (body.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${body.search}%` } },
      { slug: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const result = await Category.findAndCountAll({
    where,
    include: [{ model: Category, as: 'parent', attributes: ['id', 'name', 'slug'], required: false }],
    limit,
    offset,
    order,
    distinct: true,
  });

  return {
    rows: result.rows.map((c) => serializeCategory(c)),
    meta: toPageMeta(result, { page, limit }),
  };
}

/** Full parent/child tree, for navigation menus. */
async function categoryTree() {
  const roots = await Category.findAll({
    where: { parentId: null, isActive: true },
    include: [{
      model: Category,
      as: 'children',
      required: false,
      where: { isActive: true },
      separate: true,
      order: [['sortOrder', 'ASC']],
    }],
    order: [['sortOrder', 'ASC']],
  });

  return roots.map((c) => serializeCategory(c));
}

async function getCategory(body) {
  const category = await Category.findByPk(body.id, {
    include: [
      { model: Category, as: 'parent', attributes: ['id', 'name', 'slug'], required: false },
      { model: Category, as: 'children', required: false },
    ],
  });
  if (!category) throw AppError.notFound('Category not found');

  const productCount = await Product.count({ where: { categoryId: category.id } });
  return serializeCategory(category, { productCount });
}

async function createCategory(body, req) {
  if (body.parentId) {
    const parent = await Category.findByPk(body.parentId);
    if (!parent) throw AppError.badRequest('Parent category does not exist');
    if (parent.parentId) {
      // Two levels keep navigation predictable and avoid recursive queries.
      throw AppError.badRequest('Categories support only two levels of nesting');
    }
  }

  const category = await Category.create({
    parentId: body.parentId || null,
    name: body.name,
    slug: await uniqueSlug(Category, body.slug || body.name),
    description: body.description || null,
    imageUrl: body.imageUrl || null,
    sortOrder: body.sortOrder ?? 0,
    createdBy: req.user.id,
  });

  return getCategory({ id: category.id });
}

async function updateCategory(body, req) {
  const category = await Category.findByPk(body.id);
  if (!category) throw AppError.notFound('Category not found');

  if (body.parentId !== undefined && body.parentId !== null) {
    if (Number(body.parentId) === Number(category.id)) {
      throw AppError.badRequest('A category cannot be its own parent');
    }
    const parent = await Category.findByPk(body.parentId);
    if (!parent) throw AppError.badRequest('Parent category does not exist');
    if (parent.parentId) throw AppError.badRequest('Categories support only two levels of nesting');

    // Moving a category that has children under another parent would create a
    // third level, so it is refused.
    const hasChildren = await Category.count({ where: { parentId: category.id } });
    if (hasChildren) {
      throw AppError.badRequest('This category has sub-categories and cannot be nested under another category');
    }
  }

  await category.update({
    parentId: body.parentId === undefined ? category.parentId : body.parentId,
    name: body.name ?? category.name,
    slug: body.slug
      ? await uniqueSlug(Category, body.slug, { excludeId: category.id })
      : category.slug,
    description: body.description ?? category.description,
    imageUrl: body.imageUrl ?? category.imageUrl,
    sortOrder: body.sortOrder ?? category.sortOrder,
    isActive: body.isActive ?? category.isActive,
    updatedBy: req.user.id,
  });

  return getCategory({ id: category.id });
}

async function deleteCategory(body, req) {
  const category = await Category.findByPk(body.id);
  if (!category) throw AppError.notFound('Category not found');

  const productCount = await Product.count({ where: { categoryId: category.id } });
  if (productCount > 0) {
    throw AppError.conflict(
      `${productCount} product(s) are in this category. Move them before deleting it.`
    );
  }

  const childCount = await Category.count({ where: { parentId: category.id } });
  if (childCount > 0) {
    throw AppError.conflict(`This category has ${childCount} sub-categories. Delete those first.`);
  }

  await category.update({ deletedBy: req.user.id, isActive: false });
  await category.destroy();

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

function serializeBrand(brand, extra = {}) {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    description: brand.description,
    logoUrl: brand.logoUrl,
    countryOfOrigin: brand.countryOfOrigin,
    isActive: brand.isActive,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
    ...extra,
  };
}

async function listBrands(body) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: BRAND_SORTABLE,
    defaultSort: 'name',
    defaultOrder: 'ASC',
  });

  const where = {};
  if (body.isActive !== undefined && body.isActive !== null) where.isActive = body.isActive;
  if (body.countryOfOrigin) where.countryOfOrigin = body.countryOfOrigin;
  if (body.search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${body.search}%` } },
      { slug: { [Op.like]: `%${body.search}%` } },
    ];
  }

  const result = await Brand.findAndCountAll({ where, limit, offset, order });
  return { rows: result.rows.map((b) => serializeBrand(b)), meta: toPageMeta(result, { page, limit }) };
}

async function getBrand(body) {
  const brand = await Brand.findByPk(body.id);
  if (!brand) throw AppError.notFound('Brand not found');
  const productCount = await Product.count({ where: { brandId: brand.id } });
  return serializeBrand(brand, { productCount });
}

async function createBrand(body, req) {
  const brand = await Brand.create({
    name: body.name,
    slug: await uniqueSlug(Brand, body.slug || body.name),
    description: body.description || null,
    logoUrl: body.logoUrl || null,
    countryOfOrigin: body.countryOfOrigin || null,
    createdBy: req.user.id,
  });

  return serializeBrand(brand);
}

async function updateBrand(body, req) {
  const brand = await Brand.findByPk(body.id);
  if (!brand) throw AppError.notFound('Brand not found');

  await brand.update({
    name: body.name ?? brand.name,
    slug: body.slug ? await uniqueSlug(Brand, body.slug, { excludeId: brand.id }) : brand.slug,
    description: body.description ?? brand.description,
    logoUrl: body.logoUrl ?? brand.logoUrl,
    countryOfOrigin: body.countryOfOrigin ?? brand.countryOfOrigin,
    isActive: body.isActive ?? brand.isActive,
    updatedBy: req.user.id,
  });

  return getBrand({ id: brand.id });
}

async function deleteBrand(body, req) {
  const brand = await Brand.findByPk(body.id);
  if (!brand) throw AppError.notFound('Brand not found');

  const productCount = await Product.count({ where: { brandId: brand.id } });
  if (productCount > 0) {
    throw AppError.conflict(
      `${productCount} product(s) reference this brand. Reassign them before deleting it.`
    );
  }

  await brand.update({ deletedBy: req.user.id, isActive: false });
  await brand.destroy();

  return { deleted: true };
}

module.exports = {
  listCategories,
  categoryTree,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  listBrands,
  getBrand,
  createBrand,
  updateBrand,
  deleteBrand,
  serializeCategory,
  serializeBrand,
};
