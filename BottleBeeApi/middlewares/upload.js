'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const config = require('../config');
const AppError = require('../utils/AppError');

/**
 * Local disk uploads for KYC documents, licences and product images.
 *
 * Filenames are always regenerated from random bytes: a client-supplied name is
 * a path-traversal and content-sniffing risk, and is never trusted. Extension
 * is derived from the accepted MIME type, not from the original name.
 */

const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

function ensureDir(dir) {
  const resolved = path.resolve(process.cwd(), config.upload.dir, dir);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function makeStorage(subdir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, ensureDir(subdir));
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const ext = EXTENSION_BY_MIME[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`);
    },
  });
}

function makeFilter(allowedMimes) {
  return (req, file, cb) => {
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(
        AppError.validation('Unsupported file type', [
          { field: file.fieldname, message: `Allowed types: ${allowedMimes.join(', ')}` },
        ])
      );
    }
    return cb(null, true);
  };
}

/** Identity documents and vendor licences: images plus PDF. */
const documentUpload = multer({
  storage: makeStorage('documents'),
  fileFilter: makeFilter(config.upload.allowedDocumentMimes),
  limits: { fileSize: config.upload.maxSizeBytes, files: 5 },
});

/** Product and brand imagery: images only. */
const imageUpload = multer({
  storage: makeStorage('products'),
  fileFilter: makeFilter(config.upload.allowedImageMimes),
  limits: { fileSize: config.upload.maxSizeBytes, files: 10 },
});

/** Public URL for a stored upload, as persisted on the owning record. */
function publicUrl(file) {
  if (!file) return null;
  const relative = path
    .relative(path.resolve(process.cwd(), config.upload.dir), file.path)
    .split(path.sep)
    .join('/');
  return `/${config.upload.dir}/${relative}`;
}

module.exports = { documentUpload, imageUpload, publicUrl, EXTENSION_BY_MIME };
