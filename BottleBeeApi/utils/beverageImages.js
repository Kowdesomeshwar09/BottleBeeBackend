'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./../config');
const logger = require('./../config/logger');
const { PRODUCT_TYPE } = require('./../config/constants');

/**
 * Category images for beverages, fetched from a free public source.
 *
 * WHY CATEGORY IMAGES AND NOT PRODUCT PHOTOGRAPHS
 *
 * The obvious idea is to look a bottle up by brand and use the photograph that
 * comes back. That was tried against Open Food Facts, the largest free product
 * database, and it is not fit for this purpose:
 *
 *   - Brand collisions return the wrong product entirely. Searching `sula`, an
 *     Indian wine producer, returns "Leche" — Spanish milk. Searching `absolut`
 *     returns a Heinz tomato-and-vodka pasta sauce.
 *   - Its v2 search ignores `search_terms`, so a name query silently returns
 *     the same first page for every product.
 *   - Roughly two in five requests answer HTTP 503.
 *   - Indian brands, which are most of this catalogue, are barely covered.
 *
 * On a platform selling a regulated product, a photograph of the wrong bottle
 * is worse than no photograph: type and strength carry legal weight, and a
 * customer must not be misled about what they are buying. So this module does
 * something narrower and honest — it supplies an image of the right *category*,
 * labels it plainly as such, and leaves the actual photograph to the store that
 * holds the stock. `products/images/add` already exists for that, and the seller
 * is the only party who can supply an accurate picture anyway.
 *
 * Source: TheCocktailDB's ingredient images. Free, no key, no rate limit
 * published, and it covers every product type in PRODUCT_TYPE. Images are
 * downloaded once and served from our own `uploads/` directory, so there is no
 * runtime dependency on a third party and no hotlinking.
 */

const SOURCE = 'https://www.thecocktaildb.com/images/ingredients';
const USER_AGENT = 'BottleBee/1.0 (marketplace catalogue seeding)';

/** How long to wait on the source before giving up on one image. */
const FETCH_TIMEOUT_MS = 20_000;

/** Cap on a single download, so a redirect to something huge cannot fill the disk. */
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Candidate ingredient names per product type, best first.
 *
 * Several names are tried because the source's vocabulary is fixed and does not
 * always use the word our enum does — it has no "LIQUEUR", but it has Amaretto.
 */
const CANDIDATES = {
  [PRODUCT_TYPE.BEER]: ['Beer', 'Lager'],
  [PRODUCT_TYPE.WINE]: ['Red Wine', 'White Wine', 'Wine'],
  [PRODUCT_TYPE.WHISKEY]: ['Whiskey', 'Scotch', 'Bourbon'],
  [PRODUCT_TYPE.VODKA]: ['Vodka'],
  [PRODUCT_TYPE.GIN]: ['Gin'],
  [PRODUCT_TYPE.RUM]: ['Rum', 'Dark Rum', 'Light Rum'],
  [PRODUCT_TYPE.TEQUILA]: ['Tequila'],
  [PRODUCT_TYPE.BRANDY]: ['Brandy', 'Cognac'],
  [PRODUCT_TYPE.LIQUEUR]: ['Amaretto', 'Triple Sec', 'Kahlua'],
  [PRODUCT_TYPE.CHAMPAGNE]: ['Champagne', 'Prosecco'],
  [PRODUCT_TYPE.OTHER]: ['Bitters', 'Vermouth'],
};

/** Alt text that does not pretend to be the product. */
const altTextFor = (productName, productType) =>
  `Representative ${String(productType || 'beverage').toLowerCase()} image. `
  + `Not a photograph of ${productName}.`;

const targetDir = () => {
  const dir = path.resolve(process.cwd(), config.upload.dir, 'products');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Mirrors `publicUrl` in the upload middleware, so both produce the same shape. */
const publicPathFor = (filename) => `/${config.upload.dir}/products/${filename}`;

/**
 * Downloads one URL to disk and returns its public path.
 *
 * Verifies the response really is an image before writing: a source that starts
 * answering with an HTML error page must not leave a `.png` full of markup on
 * disk for the storefront to render as a broken image.
 */
async function download(url, { signal } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal });
  if (!res.ok) throw new Error(`source answered HTTP ${res.status}`);

  const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim();
  if (!config.upload.allowedImageMimes.includes(contentType)) {
    throw new Error(`unexpected content type "${contentType || 'none'}"`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('source returned an empty body');
  if (buffer.length > MAX_BYTES) {
    throw new Error(`image is ${buffer.length} bytes, over the ${MAX_BYTES} cap`);
  }

  const ext = contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/webp' ? '.webp' : '.png';
  const filename = `category-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

  fs.writeFileSync(path.join(targetDir(), filename), buffer);

  return { publicPath: publicPathFor(filename), bytes: buffer.length, contentType };
}

/**
 * Fetches a category image for one product type.
 *
 * Returns null rather than throwing when nothing can be had: a catalogue
 * without a picture still sells, and one product's missing image must not abort
 * a backfill over hundreds.
 */
async function fetchCategoryImage(productType, { productName = 'this product' } = {}) {
  const candidates = CANDIDATES[productType] || CANDIDATES[PRODUCT_TYPE.OTHER];

  for (const name of candidates) {
    const url = `${SOURCE}/${encodeURIComponent(name)}-Medium.png`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await download(url, { signal: controller.signal });

      return {
        ...result,
        sourceUrl: url,
        matchedName: name,
        altText: altTextFor(productName, productType),
      };
    } catch (error) {
      logger.warn(
        '[beverage images] %s via "%s" failed: %s',
        productType,
        name,
        error.name === 'AbortError' ? `timed out after ${FETCH_TIMEOUT_MS}ms` : error.message
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

/** The product types this module can supply an image for. */
const supportedTypes = () => Object.keys(CANDIDATES);

module.exports = {
  fetchCategoryImage,
  supportedTypes,
  altTextFor,
  CANDIDATES,
  SOURCE,
};
