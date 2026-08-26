'use strict';

const service = require('../services/compliance.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, paginated, updated, deleted } = require('../utils/response');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.list(req.body, req);
  return paginated(res, rows, meta, 'Compliance rules fetched successfully');
});

const detail = asyncHandler(async (req, res) => {
  const rule = await service.detail(req.body, req);
  return ok(res, rule, 'Compliance rule fetched successfully');
});

const save = asyncHandler(async (req, res) => {
  const rule = await service.upsert(req.body, req);
  return updated(res, rule, 'Compliance rule saved successfully');
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.body, req);
  return deleted(res, 'Compliance rule deleted successfully');
});

const serviceability = asyncHandler(async (req, res) => {
  const result = await service.checkServiceability(req.body);
  return ok(res, result, 'Serviceability checked successfully');
});

module.exports = { list, detail, save, remove, serviceability };
