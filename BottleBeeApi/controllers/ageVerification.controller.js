'use strict';

const service = require('../services/ageVerification.service');
const asyncHandler = require('../utils/asyncHandler');
const { publicUrl } = require('../middlewares/upload');
const { ok, created, paginated, updated } = require('../utils/response');

/** Maps multer's `fields` output to the public URLs stored on the record. */
function collectFiles(req) {
  const files = req.files || {};
  return {
    documentFront: publicUrl(files.documentFront?.[0]),
    documentBack: publicUrl(files.documentBack?.[0]),
    selfie: publicUrl(files.selfie?.[0]),
  };
}

const submit = asyncHandler(async (req, res) => {
  const result = await service.submit(req.body, collectFiles(req), req);
  return created(res, result, 'Documents submitted for verification');
});

const myStatus = asyncHandler(async (req, res) => {
  const result = await service.myStatus(req);
  return ok(res, result, 'Verification status fetched successfully');
});

const eligibility = asyncHandler(async (req, res) => {
  const result = await service.eligibility(req);
  return ok(res, result, 'Eligibility checked successfully');
});

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.list(req.body, req);
  return paginated(res, rows, meta, 'Verifications fetched successfully');
});

const detail = asyncHandler(async (req, res) => {
  const result = await service.detail(req.body, req);
  return ok(res, result, 'Verification fetched successfully');
});

const review = asyncHandler(async (req, res) => {
  const result = await service.review(req.body, req);
  return updated(res, result, `Verification ${req.body.status.toLowerCase()} successfully`);
});

const expireLapsed = asyncHandler(async (req, res) => {
  const result = await service.expireLapsed(req);
  return ok(res, result, 'Lapsed verifications expired');
});

module.exports = { submit, myStatus, eligibility, list, detail, review, expireLapsed };
