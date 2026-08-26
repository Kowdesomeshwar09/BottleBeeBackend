'use strict';

const service = require('../services/product.service');
const asyncHandler = require('../utils/asyncHandler');
const { publicUrl } = require('../middlewares/upload');
const { ok, created, paginated, updated, deleted } = require('../utils/response');

const create = asyncHandler(async (req, res) => {
  const product = await service.create(req.body, req);
  return created(res, product, 'Product created successfully');
});

const update = asyncHandler(async (req, res) => {
  const product = await service.update(req.body, req);
  return updated(res, product, 'Product updated successfully');
});

const submitForApproval = asyncHandler(async (req, res) => {
  const product = await service.submitForApproval(req.body, req);
  return updated(res, product, 'Product submitted for approval');
});

const review = asyncHandler(async (req, res) => {
  const product = await service.review(req.body, req);
  const verb = req.body.status === 'ACTIVE' ? 'approved' : 'rejected';
  return updated(res, product, `Product ${verb} successfully`);
});

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.list(req.body, req);
  return paginated(res, rows, meta, 'Products fetched successfully');
});

const detail = asyncHandler(async (req, res) => {
  const product = await service.detail(req.body, req);
  return ok(res, product, 'Product fetched successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.body, req);
  return deleted(res, 'Product deleted successfully');
});

const createVariant = asyncHandler(async (req, res) => {
  const variant = await service.createVariant(req.body, req);
  return created(res, variant, 'Variant created successfully');
});

const updateVariant = asyncHandler(async (req, res) => {
  const variant = await service.updateVariant(req.body, req);
  return updated(res, variant, 'Variant updated successfully');
});

const deleteVariant = asyncHandler(async (req, res) => {
  await service.deleteVariant(req.body, req);
  return deleted(res, 'Variant deleted successfully');
});

const addImages = asyncHandler(async (req, res) => {
  const files = (req.files || []).map((file) => ({ url: publicUrl(file) }));
  const images = await service.addImages(req.body, files, req);
  return created(res, images, 'Images uploaded successfully');
});

const setPrimaryImage = asyncHandler(async (req, res) => {
  const image = await service.setPrimaryImage(req.body, req);
  return updated(res, image, 'Primary image updated successfully');
});

const deleteImage = asyncHandler(async (req, res) => {
  await service.deleteImage(req.body, req);
  return deleted(res, 'Image deleted successfully');
});

// --- Public catalog ---------------------------------------------------------

const publicList = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.publicList(req.body);
  return paginated(res, rows, meta, 'Products fetched successfully');
});

const publicDetail = asyncHandler(async (req, res) => {
  const product = await service.publicDetail(req.body);
  return ok(res, product, 'Product fetched successfully');
});

const publicFilters = asyncHandler(async (req, res) => {
  const filters = await service.publicFilters(req.body);
  return ok(res, filters, 'Filters fetched successfully');
});

const publicVendorDetail = asyncHandler(async (req, res) => {
  const vendor = await service.publicVendorDetail(req.body);
  return ok(res, vendor, 'Store fetched successfully');
});

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
};
