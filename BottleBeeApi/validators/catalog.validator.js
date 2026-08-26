'use strict';

const {
  Joi, requiredId, id, name, longText, url, listSchema,
} = require('./common');

// --- Categories -------------------------------------------------------------

const listCategoriesSchema = listSchema({
  parentId: id.allow(null),
  topLevelOnly: Joi.boolean(),
  isActive: Joi.boolean(),
});

const createCategorySchema = Joi.object({
  parentId: id.allow(null),
  name: name(150).required(),
  slug: Joi.string().trim().lowercase().max(180),
  description: longText,
  imageUrl: url,
  sortOrder: Joi.number().integer().min(0).max(9999).default(0),
});

const updateCategorySchema = Joi.object({
  id: requiredId(),
  parentId: id.allow(null),
  name: name(150),
  slug: Joi.string().trim().lowercase().max(180),
  description: longText,
  imageUrl: url,
  sortOrder: Joi.number().integer().min(0).max(9999),
  isActive: Joi.boolean(),
}).min(2);

// --- Brands -----------------------------------------------------------------

const listBrandsSchema = listSchema({
  countryOfOrigin: name(100),
  isActive: Joi.boolean(),
});

const createBrandSchema = Joi.object({
  name: name(150).required(),
  slug: Joi.string().trim().lowercase().max(180),
  description: longText,
  logoUrl: url,
  countryOfOrigin: name(100).allow('', null),
});

const updateBrandSchema = Joi.object({
  id: requiredId(),
  name: name(150),
  slug: Joi.string().trim().lowercase().max(180),
  description: longText,
  logoUrl: url,
  countryOfOrigin: name(100).allow('', null),
  isActive: Joi.boolean(),
}).min(2);

const idSchema = Joi.object({ id: requiredId() });
const emptySchema = Joi.object({});

module.exports = {
  listCategoriesSchema,
  createCategorySchema,
  updateCategorySchema,
  listBrandsSchema,
  createBrandSchema,
  updateBrandSchema,
  idSchema,
  emptySchema,
};
