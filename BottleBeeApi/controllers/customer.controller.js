'use strict';

const customerService = require('../services/customer.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, updated, deleted, paginated } = require('../utils/response');

const saveProfile = asyncHandler(async (req, res) => {
  const profile = await customerService.saveProfile(req.body, req);
  return ok(res, profile, 'Profile saved successfully');
});

const getProfile = asyncHandler(async (req, res) => {
  const profile = await customerService.getProfile(req);
  return ok(res, profile, 'Profile fetched successfully');
});

const adminList = asyncHandler(async (req, res) => {
  const { rows, meta } = await customerService.adminList(req.body, req);
  return paginated(res, rows, meta, 'Customers fetched successfully');
});

const adminDetail = asyncHandler(async (req, res) => {
  const profile = await customerService.adminGetProfile(req.body, req);
  return ok(res, profile, 'Customer fetched successfully');
});

const listAddresses = asyncHandler(async (req, res) => {
  const { rows, meta } = await customerService.listAddresses(req.body, req);
  return paginated(res, rows, meta, 'Addresses fetched successfully');
});

const createAddress = asyncHandler(async (req, res) => {
  const address = await customerService.createAddress(req.body, req);
  return created(res, address, 'Address added successfully');
});

const updateAddress = asyncHandler(async (req, res) => {
  const address = await customerService.updateAddress(req.body, req);
  return updated(res, address, 'Address updated successfully');
});

const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await customerService.setDefaultAddress(req.body, req);
  return updated(res, address, 'Default address updated successfully');
});

const deleteAddress = asyncHandler(async (req, res) => {
  await customerService.deleteAddress(req.body, req);
  return deleted(res, 'Address deleted successfully');
});

const checkServiceability = asyncHandler(async (req, res) => {
  const result = await customerService.checkAddressServiceability(req.body, req);
  return ok(res, result, 'Serviceability checked successfully');
});

const orderSummary = asyncHandler(async (req, res) => {
  const summary = await customerService.orderSummary(req);
  return ok(res, summary, 'Order summary fetched successfully');
});

module.exports = {
  saveProfile,
  getProfile,
  adminList,
  adminDetail,
  listAddresses,
  createAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress,
  checkServiceability,
  orderSummary,
};
