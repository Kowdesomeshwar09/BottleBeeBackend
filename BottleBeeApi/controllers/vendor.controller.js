'use strict';

const service = require('../services/vendor.service');
const asyncHandler = require('../utils/asyncHandler');
const { publicUrl } = require('../middlewares/upload');
const { ok, created, paginated, updated, deleted } = require('../utils/response');

const apply = asyncHandler(async (req, res) => {
  const vendor = await service.apply(req.body, req);
  return created(res, vendor, 'Store application submitted successfully');
});

const update = asyncHandler(async (req, res) => {
  const vendor = await service.update(req.body, req);
  return updated(res, vendor, 'Store updated successfully');
});

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.list(req.body, req);
  return paginated(res, rows, meta, 'Stores fetched successfully');
});

const detail = asyncHandler(async (req, res) => {
  const vendor = await service.detail(req.body, req);
  return ok(res, vendor, 'Store fetched successfully');
});

const myVendors = asyncHandler(async (req, res) => {
  const vendors = await service.myVendors(req);
  return ok(res, vendors, 'Your stores fetched successfully');
});

const review = asyncHandler(async (req, res) => {
  const vendor = await service.review(req.body, req);
  return updated(res, vendor, `Store ${req.body.status.toLowerCase()} successfully`);
});

const addLicense = asyncHandler(async (req, res) => {
  const files = { document: publicUrl(req.files?.document?.[0] || req.file) };
  const licence = await service.addLicense(req.body, files, req);
  return created(res, licence, 'Licence submitted for review');
});

const listLicenses = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.listLicenses(req.body, req);
  return paginated(res, rows, meta, 'Licences fetched successfully');
});

const reviewLicense = asyncHandler(async (req, res) => {
  const licence = await service.reviewLicense(req.body, req);
  return updated(res, licence, `Licence ${req.body.status.toLowerCase()} successfully`);
});

const saveAddress = asyncHandler(async (req, res) => {
  const address = await service.saveAddress(req.body, req);
  return updated(res, address, 'Store address saved successfully');
});

const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await service.listAddresses(req.body, req);
  return ok(res, addresses, 'Store addresses fetched successfully');
});

const addStaff = asyncHandler(async (req, res) => {
  const membership = await service.addStaff(req.body, req);
  return created(res, membership, 'Staff member added successfully');
});

const listStaff = asyncHandler(async (req, res) => {
  const staff = await service.listStaff(req.body, req);
  return ok(res, staff, 'Staff fetched successfully');
});

const removeStaff = asyncHandler(async (req, res) => {
  await service.removeStaff(req.body, req);
  return deleted(res, 'Staff member removed successfully');
});

module.exports = {
  apply,
  update,
  list,
  detail,
  myVendors,
  review,
  addLicense,
  listLicenses,
  reviewLicense,
  saveAddress,
  listAddresses,
  addStaff,
  listStaff,
  removeStaff,
};
