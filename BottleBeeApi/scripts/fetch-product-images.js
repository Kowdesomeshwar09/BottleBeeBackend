'use strict';

/**
 * Backfills category images onto products that have none.
 *
 * The same work the `products/images/backfill-category` endpoint does, but
 * runnable without a server or a token — which is what you want right after
 * seeding, when the catalogue exists and nothing has a picture yet.
 *
 * Usage:
 *   node scripts/fetch-product-images.js
 *   node scripts/fetch-product-images.js --type=WHISKEY
 *   node scripts/fetch-product-images.js --vendor=1 --limit=20
 *   node scripts/fetch-product-images.js --replace        (overwrite existing)
 *   node scripts/fetch-product-images.js --dry-run        (report, change nothing)
 *
 * See utils/beverageImages.js for why these are category images rather than
 * brand photographs.
 */

const {
  sequelize, Product, ProductImage,
} = require('../models');
const { PRODUCT_TYPE } = require('../config/constants');
const beverageImages = require('../utils/beverageImages');

/** Parses `--key=value` and bare `--flag` arguments. */
function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const [key, value] = raw.slice(2).split('=');
    args[key] = value === undefined ? true : value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const dryRun = args['dry-run'] === true;
  const replace = args.replace === true;
  const limit = Math.min(Number(args.limit) || 200, 500);

  const where = { isActive: true };
  if (args.type) {
    const type = String(args.type).toUpperCase();
    if (!PRODUCT_TYPE[type]) {
      throw new Error(`Unknown --type "${args.type}". One of: ${Object.keys(PRODUCT_TYPE).join(', ')}`);
    }
    where.productType = type;
  }
  if (args.vendor) where.vendorId = Number(args.vendor);
  if (args.status) where.status = String(args.status).toUpperCase();

  const products = await Product.findAll({
    where,
    include: [{ model: ProductImage, as: 'images', required: false, attributes: ['id'] }],
    limit,
    order: [['id', 'ASC']],
  });

  console.log(`\nBottle Bee — product image backfill`);
  console.log(`Source: ${beverageImages.SOURCE}`);
  console.log(`Products in scope: ${products.length}${dryRun ? '  (dry run)' : ''}\n`);

  const counts = { attached: 0, skipped: 0, failed: 0 };

  for (const product of products) {
    const label = `#${product.id} ${product.name}`.padEnd(48).slice(0, 48);
    const hasImages = (product.images || []).length > 0;

    if (hasImages && !replace) {
      counts.skipped += 1;
      console.log(`${label} skip   already has an image`);
      continue;
    }

    if (dryRun) {
      counts.attached += 1;
      console.log(`${label} would  fetch a ${product.productType} image`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const image = await beverageImages.fetchCategoryImage(product.productType, {
      productName: product.name,
    });

    if (!image) {
      counts.failed += 1;
      console.log(`${label} FAIL   no image available for ${product.productType}`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await sequelize.transaction(async (transaction) => {
      const existingCount = await ProductImage.count({
        where: { productId: product.id },
        transaction,
      });

      await ProductImage.create(
        {
          productId: product.id,
          imageUrl: image.publicPath,
          altText: image.altText,
          sortOrder: existingCount,
          // Only claim primary when nothing else already holds it.
          isPrimary: existingCount === 0,
          createdBy: null,
        },
        { transaction }
      );
    });

    counts.attached += 1;
    console.log(`${label} ok     ${image.publicPath}  (${image.matchedName})`);
  }

  console.log(
    `\nAttached ${counts.attached}, skipped ${counts.skipped}, failed ${counts.failed}.`
  );

  if (counts.attached > 0 && !dryRun) {
    console.log(
      '\nThese are category images, not photographs of the products. Stores should\n'
      + 'replace them with their own via products/images/add.'
    );
  }
}

main()
  .then(async () => {
    await sequelize.close();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`\nBackfill failed: ${error.message}`);
    await sequelize.close().catch(() => undefined);
    process.exit(1);
  });
