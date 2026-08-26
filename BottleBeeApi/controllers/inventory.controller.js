'use strict';

const service = require('../services/inventory.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, paginated, updated } = require('../utils/response');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.list(req.body, req);
  return paginated(res, rows, meta, 'Inventory fetched successfully');
});

const detail = asyncHandler(async (req, res) => {
  const inventory = await service.detail(req.body, req);
  return ok(res, inventory, 'Inventory record fetched successfully');
});

const adjust = asyncHandler(async (req, res) => {
  const inventory = await service.adjust(req.body, req);
  return updated(res, inventory, 'Stock adjusted successfully');
});

const bulkAdjust = asyncHandler(async (req, res) => {
  const result = await service.bulkAdjust(req.body, req);
  const message = result.failed
    ? `${result.updated} record(s) updated, ${result.failed} failed`
    : `${result.updated} record(s) updated successfully`;
  return updated(res, result, message);
});

const transactions = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.transactions(req.body, req);
  return paginated(res, rows, meta, 'Stock movements fetched successfully');
});

const lowStock = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.lowStock(req.body, req);
  return paginated(res, rows, meta, 'Low stock items fetched successfully');
});

const summary = asyncHandler(async (req, res) => {
  const result = await service.summary(req.body, req);
  return ok(res, result, 'Inventory summary fetched successfully');
});

module.exports = { list, detail, adjust, bulkAdjust, transactions, lowStock, summary };
