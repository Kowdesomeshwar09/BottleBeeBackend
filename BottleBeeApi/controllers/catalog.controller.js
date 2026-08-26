'use strict';

const service = require('../services/catalog.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, paginated, updated, deleted } = require('../utils/response');

// --- Categories -------------------------------------------------------------

const listCategories = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.listCategories(req.body, req);
  return paginated(res, rows, meta, 'Categories fetched successfully');
});

const categoryTree = asyncHandler(async (req, res) => {
  const tree = await service.categoryTree();
  return ok(res, tree, 'Category tree fetched successfully');
});

const getCategory = asyncHandler(async (req, res) => {
  const category = await service.getCategory(req.body, req);
  return ok(res, category, 'Category fetched successfully');
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.body, req);
  return created(res, category, 'Category created successfully');
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await service.updateCategory(req.body, req);
  return updated(res, category, 'Category updated successfully');
});

const deleteCategory = asyncHandler(async (req, res) => {
  await service.deleteCategory(req.body, req);
  return deleted(res, 'Category deleted successfully');
});

// --- Brands -----------------------------------------------------------------

const listBrands = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.listBrands(req.body, req);
  return paginated(res, rows, meta, 'Brands fetched successfully');
});

const getBrand = asyncHandler(async (req, res) => {
  const brand = await service.getBrand(req.body, req);
  return ok(res, brand, 'Brand fetched successfully');
});

const createBrand = asyncHandler(async (req, res) => {
  const brand = await service.createBrand(req.body, req);
  return created(res, brand, 'Brand created successfully');
});

const updateBrand = asyncHandler(async (req, res) => {
  const brand = await service.updateBrand(req.body, req);
  return updated(res, brand, 'Brand updated successfully');
});

const deleteBrand = asyncHandler(async (req, res) => {
  await service.deleteBrand(req.body, req);
  return deleted(res, 'Brand deleted successfully');
});

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
};
