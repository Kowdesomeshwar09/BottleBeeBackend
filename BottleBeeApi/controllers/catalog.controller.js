'use strict';

const { Op } = require('sequelize');

const { Category, Brand, Product } = require('../models');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { uniqueSlug } = require('../utils/slug');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');

/**
 * Categories and brands.
 *
 * Both are platform-owned reference data, not vendor-owned: a vendor picks from
 * them when publishing a product. Deletion is refused while any product still
 * references the row, so the catalog can never point at a missing category or
 * brand — the alternative is a storefront that renders blank filter facets.
 *
 * Categories are limited to two levels. Deeper nesting would need recursive
 * queries for navigation and gives no benefit to a drinks catalogue.
 */

const CATEGORY_SORTABLE = ['id', 'name', 'slug', 'sortOrder', 'createdAt'];
const BRAND_SORTABLE = ['id', 'name', 'slug', 'countryOfOrigin', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serializeCategory = (category, extra = {}) => ({
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
  children: category.children ? category.children.map((c) => serializeCategory(c)) : undefined,
  ...extra,
});

const serializeBrand = (brand, extra = {}) => ({
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
});

const findCategoryWithRelations = (id) => Category.findByPk(id, {
  include: [
    { model: Category, as: 'parent', attributes: ['id', 'name', 'slug'], required: false },
    { model: Category, as: 'children', required: false },
  ],
});

/* ========================================================================== */
/*                                CATEGORIES                                  */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                             LIST CATEGORIES                                */
/* -------------------------------------------------------------------------- */
const listCategories = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: CATEGORY_SORTABLE,
      defaultSort: 'sortOrder',
      defaultOrder: 'ASC',
    });

    const where = {};
    if (req.body.parentId !== undefined && req.body.parentId !== null) {
      where.parentId = req.body.parentId;
    }
    if (req.body.topLevelOnly) where.parentId = null;
    if (req.body.isActive !== undefined && req.body.isActive !== null) {
      where.isActive = req.body.isActive;
    }
    if (req.body.search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.body.search}%` } },
        { slug: { [Op.like]: `%${req.body.search}%` } },
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

    return paginated(
      res,
      result.rows.map((c) => serializeCategory(c)),
      toPageMeta(result, { page, limit }),
      'Categories fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching categories', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             CATEGORY TREE                                  */
/* -------------------------------------------------------------------------- */
/** Active categories with sub-categories nested, ordered for a navigation menu. */
const categoryTree = async (req, res) => {
  try {
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

    return ok(res, roots.map((c) => serializeCategory(c)), 'Category tree fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching category tree', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            GET ONE CATEGORY                                */
/* -------------------------------------------------------------------------- */
const getCategory = async (req, res) => {
  try {
    const category = await findCategoryWithRelations(req.body.id);
    if (!category) return fail(res, 'Category not found', 404);

    const productCount = await Product.count({ where: { categoryId: category.id } });

    return ok(res, serializeCategory(category, { productCount }), 'Category fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching category', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            CREATE A CATEGORY                               */
/* -------------------------------------------------------------------------- */
const createCategory = async (req, res) => {
  try {
    if (req.body.parentId) {
      const parent = await Category.findByPk(req.body.parentId);
      if (!parent) return fail(res, 'Parent category does not exist', 400);
      if (parent.parentId) {
        return fail(res, 'Categories support only two levels of nesting', 400);
      }
    }

    const category = await Category.create({
      parentId: req.body.parentId || null,
      name: req.body.name,
      slug: await uniqueSlug(Category, req.body.slug || req.body.name),
      description: req.body.description || null,
      imageUrl: req.body.imageUrl || null,
      sortOrder: req.body.sortOrder ?? 0,
      createdBy: req.user.id,
    });

    const fresh = await findCategoryWithRelations(category.id);
    return created(res, serializeCategory(fresh), 'Category created successfully');
  } catch (error) {
    return fail(res, 'Error creating category', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            UPDATE A CATEGORY                               */
/* -------------------------------------------------------------------------- */
const updateCategory = async (req, res) => {
  try {
    const category = await Category.findByPk(req.body.id);
    if (!category) return fail(res, 'Category not found', 404);

    if (req.body.parentId !== undefined && req.body.parentId !== null) {
      if (Number(req.body.parentId) === Number(category.id)) {
        return fail(res, 'A category cannot be its own parent', 400);
      }

      const parent = await Category.findByPk(req.body.parentId);
      if (!parent) return fail(res, 'Parent category does not exist', 400);
      if (parent.parentId) {
        return fail(res, 'Categories support only two levels of nesting', 400);
      }

      // Nesting a category that has children would create a third level.
      const childCount = await Category.count({ where: { parentId: category.id } });
      if (childCount) {
        return fail(
          res,
          'This category has sub-categories and cannot be nested under another category',
          400
        );
      }
    }

    await category.update({
      parentId: req.body.parentId === undefined ? category.parentId : req.body.parentId,
      name: req.body.name ?? category.name,
      slug: req.body.slug
        ? await uniqueSlug(Category, req.body.slug, { excludeId: category.id })
        : category.slug,
      description: req.body.description ?? category.description,
      imageUrl: req.body.imageUrl ?? category.imageUrl,
      sortOrder: req.body.sortOrder ?? category.sortOrder,
      isActive: req.body.isActive ?? category.isActive,
      updatedBy: req.user.id,
    });

    const fresh = await findCategoryWithRelations(category.id);
    return updated(res, serializeCategory(fresh), 'Category updated successfully');
  } catch (error) {
    return fail(res, 'Error updating category', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            DELETE A CATEGORY                               */
/* -------------------------------------------------------------------------- */
const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByPk(req.body.id);
    if (!category) return fail(res, 'Category not found', 404);

    const productCount = await Product.count({ where: { categoryId: category.id } });
    if (productCount > 0) {
      return fail(
        res,
        `${productCount} product(s) are in this category. Move them before deleting it.`,
        409
      );
    }

    const childCount = await Category.count({ where: { parentId: category.id } });
    if (childCount > 0) {
      return fail(res, `This category has ${childCount} sub-categories. Delete those first.`, 409);
    }

    await category.update({ deletedBy: req.user.id, isActive: false });
    await category.destroy();

    return deleted(res, 'Category deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting category', 500, [{ message: error.message }]);
  }
};

/* ========================================================================== */
/*                                  BRANDS                                    */
/* ========================================================================== */

/* -------------------------------------------------------------------------- */
/*                               LIST BRANDS                                  */
/* -------------------------------------------------------------------------- */
const listBrands = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: BRAND_SORTABLE,
      defaultSort: 'name',
      defaultOrder: 'ASC',
    });

    const where = {};
    if (req.body.isActive !== undefined && req.body.isActive !== null) {
      where.isActive = req.body.isActive;
    }
    if (req.body.countryOfOrigin) where.countryOfOrigin = req.body.countryOfOrigin;
    if (req.body.search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${req.body.search}%` } },
        { slug: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await Brand.findAndCountAll({ where, limit, offset, order });

    return paginated(
      res,
      result.rows.map((b) => serializeBrand(b)),
      toPageMeta(result, { page, limit }),
      'Brands fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching brands', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                              GET ONE BRAND                                 */
/* -------------------------------------------------------------------------- */
const getBrand = async (req, res) => {
  try {
    const brand = await Brand.findByPk(req.body.id);
    if (!brand) return fail(res, 'Brand not found', 404);

    const productCount = await Product.count({ where: { brandId: brand.id } });

    return ok(res, serializeBrand(brand, { productCount }), 'Brand fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching brand', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             CREATE A BRAND                                 */
/* -------------------------------------------------------------------------- */
const createBrand = async (req, res) => {
  try {
    const brand = await Brand.create({
      name: req.body.name,
      slug: await uniqueSlug(Brand, req.body.slug || req.body.name),
      description: req.body.description || null,
      logoUrl: req.body.logoUrl || null,
      countryOfOrigin: req.body.countryOfOrigin || null,
      createdBy: req.user.id,
    });

    return created(res, serializeBrand(brand), 'Brand created successfully');
  } catch (error) {
    return fail(res, 'Error creating brand', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             UPDATE A BRAND                                 */
/* -------------------------------------------------------------------------- */
const updateBrand = async (req, res) => {
  try {
    const brand = await Brand.findByPk(req.body.id);
    if (!brand) return fail(res, 'Brand not found', 404);

    await brand.update({
      name: req.body.name ?? brand.name,
      slug: req.body.slug
        ? await uniqueSlug(Brand, req.body.slug, { excludeId: brand.id })
        : brand.slug,
      description: req.body.description ?? brand.description,
      logoUrl: req.body.logoUrl ?? brand.logoUrl,
      countryOfOrigin: req.body.countryOfOrigin ?? brand.countryOfOrigin,
      isActive: req.body.isActive ?? brand.isActive,
      updatedBy: req.user.id,
    });

    const productCount = await Product.count({ where: { brandId: brand.id } });
    return updated(res, serializeBrand(brand, { productCount }), 'Brand updated successfully');
  } catch (error) {
    return fail(res, 'Error updating brand', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                             DELETE A BRAND                                 */
/* -------------------------------------------------------------------------- */
const deleteBrand = async (req, res) => {
  try {
    const brand = await Brand.findByPk(req.body.id);
    if (!brand) return fail(res, 'Brand not found', 404);

    const productCount = await Product.count({ where: { brandId: brand.id } });
    if (productCount > 0) {
      return fail(
        res,
        `${productCount} product(s) reference this brand. Reassign them before deleting it.`,
        409
      );
    }

    await brand.update({ deletedBy: req.user.id, isActive: false });
    await brand.destroy();

    return deleted(res, 'Brand deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting brand', 500, [{ message: error.message }]);
  }
};

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
