'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Inventory, InventoryTransaction, ProductVariant, Product, Vendor,
} = require('../models');
const {
  INVENTORY_TRANSACTION_TYPE, INVENTORY_REFERENCE_TYPE, VENDOR_ROLE, ROLES, AUDIT_ACTIONS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { recordAudit } = require('../utils/audit');
const vendorService = require('./vendor.service');
const notificationService = require('./notification.service');

/**
 * Inventory and its movement ledger.
 *
 * Stock lives in two buckets: `quantity_available` is sellable, and
 * `quantity_reserved` is held for orders that are placed but not yet delivered
 * or cancelled. The lifecycle is:
 *
 *   checkout      reserve      available -> reserved
 *   cancellation  release      reserved  -> available
 *   delivery      commitSale   reserved  -> gone (sold)
 *   refund/return returnStock  gone      -> available
 *
 * Every movement is applied with a single conditional UPDATE guarded on the
 * current balance, so two concurrent checkouts can never oversell the same unit:
 * whichever transaction loses the race matches zero rows and is rejected.
 * Every movement also writes an inventory_transactions row carrying the
 * post-movement balances, so the ledger is auditable without replaying history.
 */

const SORTABLE = ['id', 'quantityAvailable', 'quantityReserved', 'reorderLevel', 'updatedAt'];

/** Guards against a non-integer quantity reaching a SQL literal. */
function safeQuantity(value, field = 'quantity') {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw AppError.validation('Quantity must be a positive whole number', [
      { field, message: 'Must be a positive integer' },
    ]);
  }
  return qty;
}

function serialize(inventory) {
  const variant = inventory.variant;
  const product = variant?.product;

  return {
    id: inventory.id,
    vendorId: inventory.vendorId,
    productVariantId: inventory.productVariantId,
    quantityAvailable: inventory.quantityAvailable,
    quantityReserved: inventory.quantityReserved,
    quantityTotal: inventory.quantityAvailable + inventory.quantityReserved,
    reorderLevel: inventory.reorderLevel,
    isLow: inventory.quantityAvailable <= inventory.reorderLevel,
    isActive: inventory.isActive,
    updatedAt: inventory.updatedAt,
    variant: variant
      ? {
        id: variant.id,
        sku: variant.sku,
        sizeMl: variant.sizeMl,
        packSize: variant.packSize,
        sellingPrice: Number(variant.sellingPrice),
        status: variant.status,
      }
      : undefined,
    product: product
      ? { id: product.id, name: product.name, productType: product.productType, status: product.status }
      : undefined,
  };
}

function serializeTransaction(tx) {
  return {
    id: tx.id,
    inventoryId: tx.inventoryId,
    transactionType: tx.transactionType,
    quantity: tx.quantity,
    quantityAfter: tx.quantityAfter,
    reservedAfter: tx.reservedAfter,
    referenceType: tx.referenceType,
    referenceId: tx.referenceId,
    notes: tx.notes,
    createdAt: tx.createdAt,
    createdBy: tx.createdBy,
  };
}

/** Writes a ledger row. Always called inside the caller's transaction. */
async function writeLedger({
  inventory, transactionType, quantity, referenceType, referenceId = null,
  notes = null, actorId = null, transaction,
}) {
  return InventoryTransaction.create(
    {
      inventoryId: inventory.id,
      transactionType,
      quantity,
      quantityAfter: inventory.quantityAvailable,
      reservedAfter: inventory.quantityReserved,
      referenceType,
      referenceId,
      notes,
      createdBy: actorId,
    },
    { transaction }
  );
}

// ---------------------------------------------------------------------------
// Movement primitives — used by checkout, cancellation, delivery and refunds
// ---------------------------------------------------------------------------

/**
 * Moves stock from available to reserved for a set of line items.
 *
 * @param {Array<{productVariantId:number, quantity:number}>} items
 * @param {object} options
 * @param {number} options.vendorId
 * @param {number} [options.orderId]      ledger reference
 * @param {number} [options.actorId]
 * @param {object} options.transaction    REQUIRED: must join the checkout transaction
 */
async function reserve(items, { vendorId, orderId = null, actorId = null, transaction }) {
  if (!transaction) throw new Error('inventory.reserve requires a transaction');

  const reserved = [];

  for (const item of items) {
    const quantity = safeQuantity(item.quantity);

    // eslint-disable-next-line no-await-in-loop
    const inventory = await Inventory.findOne({
      where: { vendorId, productVariantId: item.productVariantId },
      transaction,
    });

    if (!inventory) {
      throw AppError.businessRule('This item is no longer stocked by the store', [
        { productVariantId: item.productVariantId, code: 'NO_INVENTORY_RECORD' },
      ]);
    }

    // Conditional update: the WHERE clause is the concurrency guard.
    // eslint-disable-next-line no-await-in-loop
    const [affected] = await Inventory.update(
      {
        quantityAvailable: sequelize.literal(`quantity_available - ${quantity}`),
        quantityReserved: sequelize.literal(`quantity_reserved + ${quantity}`),
        updatedBy: actorId,
      },
      {
        where: { id: inventory.id, quantityAvailable: { [Op.gte]: quantity } },
        transaction,
      }
    );

    if (affected === 0) {
      throw AppError.conflict(
        `Only ${inventory.quantityAvailable} unit(s) of this item are available`,
        [{
          productVariantId: item.productVariantId,
          requested: quantity,
          available: inventory.quantityAvailable,
          code: 'INSUFFICIENT_STOCK',
        }]
      );
    }

    // eslint-disable-next-line no-await-in-loop
    await inventory.reload({ transaction });

    // eslint-disable-next-line no-await-in-loop
    await writeLedger({
      inventory,
      transactionType: INVENTORY_TRANSACTION_TYPE.RESERVE,
      quantity,
      referenceType: INVENTORY_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      notes: orderId ? `Reserved for order ${orderId}` : 'Reserved at checkout',
      actorId,
      transaction,
    });

    reserved.push({ inventoryId: inventory.id, productVariantId: item.productVariantId, quantity });
  }

  return reserved;
}

/** Returns reserved stock to available — cancellation or a failed payment. */
async function release(items, { vendorId, orderId = null, actorId = null, reason = null, transaction }) {
  if (!transaction) throw new Error('inventory.release requires a transaction');

  const released = [];

  for (const item of items) {
    const quantity = safeQuantity(item.quantity);

    // eslint-disable-next-line no-await-in-loop
    const inventory = await Inventory.findOne({
      where: { vendorId, productVariantId: item.productVariantId },
      transaction,
    });
    if (!inventory) continue;

    // Never release more than is actually held, even if an order row disagrees.
    const releasable = Math.min(quantity, inventory.quantityReserved);
    if (releasable <= 0) continue;

    // eslint-disable-next-line no-await-in-loop
    await Inventory.update(
      {
        quantityAvailable: sequelize.literal(`quantity_available + ${releasable}`),
        quantityReserved: sequelize.literal(`quantity_reserved - ${releasable}`),
        updatedBy: actorId,
      },
      { where: { id: inventory.id }, transaction }
    );

    // eslint-disable-next-line no-await-in-loop
    await inventory.reload({ transaction });

    // eslint-disable-next-line no-await-in-loop
    await writeLedger({
      inventory,
      transactionType: INVENTORY_TRANSACTION_TYPE.RELEASE,
      quantity: releasable,
      referenceType: INVENTORY_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      notes: reason || (orderId ? `Released from order ${orderId}` : 'Reservation released'),
      actorId,
      transaction,
    });

    released.push({ inventoryId: inventory.id, productVariantId: item.productVariantId, quantity: releasable });
  }

  return released;
}

/** Converts a reservation into a sale on delivery: reserved units leave stock. */
async function commitSale(items, { vendorId, orderId = null, actorId = null, transaction }) {
  if (!transaction) throw new Error('inventory.commitSale requires a transaction');

  const sold = [];

  for (const item of items) {
    const quantity = safeQuantity(item.quantity);

    // eslint-disable-next-line no-await-in-loop
    const inventory = await Inventory.findOne({
      where: { vendorId, productVariantId: item.productVariantId },
      transaction,
    });
    if (!inventory) continue;

    const sellable = Math.min(quantity, inventory.quantityReserved);
    if (sellable <= 0) continue;

    // eslint-disable-next-line no-await-in-loop
    await Inventory.update(
      {
        quantityReserved: sequelize.literal(`quantity_reserved - ${sellable}`),
        updatedBy: actorId,
      },
      { where: { id: inventory.id }, transaction }
    );

    // eslint-disable-next-line no-await-in-loop
    await inventory.reload({ transaction });

    // eslint-disable-next-line no-await-in-loop
    await writeLedger({
      inventory,
      transactionType: INVENTORY_TRANSACTION_TYPE.SALE,
      quantity: sellable,
      referenceType: INVENTORY_REFERENCE_TYPE.ORDER,
      referenceId: orderId,
      notes: `Sold on order ${orderId}`,
      actorId,
      transaction,
    });

    sold.push({ inventoryId: inventory.id, productVariantId: item.productVariantId, quantity: sellable });
  }

  return sold;
}

/** Puts refunded or returned goods back on the shelf. */
async function returnStock(items, { vendorId, orderId = null, actorId = null, transaction }) {
  if (!transaction) throw new Error('inventory.returnStock requires a transaction');

  const returned = [];

  for (const item of items) {
    const quantity = safeQuantity(item.quantity);

    // eslint-disable-next-line no-await-in-loop
    const inventory = await Inventory.findOne({
      where: { vendorId, productVariantId: item.productVariantId },
      transaction,
    });
    if (!inventory) continue;

    // eslint-disable-next-line no-await-in-loop
    await Inventory.update(
      {
        quantityAvailable: sequelize.literal(`quantity_available + ${quantity}`),
        updatedBy: actorId,
      },
      { where: { id: inventory.id }, transaction }
    );

    // eslint-disable-next-line no-await-in-loop
    await inventory.reload({ transaction });

    // eslint-disable-next-line no-await-in-loop
    await writeLedger({
      inventory,
      transactionType: INVENTORY_TRANSACTION_TYPE.RETURN,
      quantity,
      referenceType: INVENTORY_REFERENCE_TYPE.REFUND,
      referenceId: orderId,
      notes: `Returned from order ${orderId}`,
      actorId,
      transaction,
    });

    returned.push({ inventoryId: inventory.id, productVariantId: item.productVariantId, quantity });
  }

  return returned;
}

/**
 * Read-only availability check used before checkout so the customer sees a
 * clear message instead of a mid-transaction failure.
 */
async function checkAvailability(items, vendorId) {
  const shortfalls = [];

  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    const inventory = await Inventory.findOne({
      where: { vendorId, productVariantId: item.productVariantId },
      include: [{
        model: ProductVariant,
        as: 'variant',
        include: [{ model: Product, as: 'product', attributes: ['name'] }],
      }],
    });

    const available = inventory?.quantityAvailable ?? 0;
    if (available < item.quantity) {
      shortfalls.push({
        productVariantId: item.productVariantId,
        productName: inventory?.variant?.product?.name || null,
        sku: inventory?.variant?.sku || null,
        requested: item.quantity,
        available,
      });
    }
  }

  return { available: shortfalls.length === 0, shortfalls };
}

// ---------------------------------------------------------------------------
// Vendor-facing management
// ---------------------------------------------------------------------------

/** Restricts a query to vendors the caller may see. */
async function scopeToVendor(body, req, where) {
  const isStaff = req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);

  if (body.vendorId) {
    await vendorService.assertVendorAccess(body.vendorId, req);
    where.vendorId = body.vendorId;
    return true;
  }

  if (!isStaff) {
    const ids = await vendorService.myVendorIds(req);
    if (!ids.length) return false;
    where.vendorId = { [Op.in]: ids };
  }

  return true;
}

async function list(body, req) {
  const { page, limit, offset, order } = buildPagination(body, {
    sortable: SORTABLE,
    defaultSort: 'updatedAt',
  });

  const where = {};
  if (!(await scopeToVendor(body, req, where))) {
    return { rows: [], meta: { page, limit, total: 0 } };
  }

  if (body.lowStockOnly) {
    where.quantityAvailable = { [Op.lte]: sequelize.col('reorder_level') };
  }
  if (body.outOfStockOnly) where.quantityAvailable = 0;

  const variantWhere = {};
  if (body.search) variantWhere.sku = { [Op.like]: `%${body.search}%` };

  const result = await Inventory.findAndCountAll({
    where,
    include: [{
      model: ProductVariant,
      as: 'variant',
      required: true,
      ...(Object.keys(variantWhere).length ? { where: variantWhere } : {}),
      include: [{
        model: Product,
        as: 'product',
        required: true,
        attributes: ['id', 'name', 'productType', 'status'],
        ...(body.productId ? { where: { id: body.productId } } : {}),
      }],
    }],
    limit,
    offset,
    order,
    distinct: true,
  });

  return { rows: result.rows.map(serialize), meta: toPageMeta(result, { page, limit }) };
}

async function detail(body, req) {
  const inventory = await Inventory.findByPk(body.id, {
    include: [{
      model: ProductVariant,
      as: 'variant',
      include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'productType', 'status'] }],
    }],
  });
  if (!inventory) throw AppError.notFound('Inventory record not found');

  await vendorService.assertVendorAccess(inventory.vendorId, req);
  return serialize(inventory);
}

/**
 * Manual stock movement by a vendor.
 *
 * STOCK_IN adds units, STOCK_OUT removes them (breakage, transfer), and
 * ADJUSTMENT sets an absolute count after a physical stock take. Reserved units
 * are never touched here — those belong to live orders.
 */
async function adjust(body, req) {
  const inventory = await Inventory.findByPk(body.id, {
    include: [{
      model: ProductVariant,
      as: 'variant',
      include: [{ model: Product, as: 'product', attributes: ['id', 'name'] }],
    }],
  });
  if (!inventory) throw AppError.notFound('Inventory record not found');

  await vendorService.assertVendorAccess(inventory.vendorId, req, {
    requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER],
  });

  const before = {
    quantityAvailable: inventory.quantityAvailable,
    quantityReserved: inventory.quantityReserved,
    reorderLevel: inventory.reorderLevel,
  };

  await sequelize.transaction(async (transaction) => {
    let delta;
    let transactionType;

    if (body.transactionType === INVENTORY_TRANSACTION_TYPE.ADJUSTMENT) {
      // Absolute set. A stock take counts what is on the shelf, which excludes
      // units already reserved for orders awaiting pickup.
      const target = Number(body.quantity);
      if (!Number.isInteger(target) || target < 0) {
        throw AppError.validation('An adjustment quantity must be zero or a positive whole number', [
          { field: 'quantity', message: 'Must be an integer of 0 or more' },
        ]);
      }
      delta = target - inventory.quantityAvailable;
      transactionType = INVENTORY_TRANSACTION_TYPE.ADJUSTMENT;

      await inventory.update({ quantityAvailable: target, updatedBy: req.user.id }, { transaction });
    } else {
      const quantity = safeQuantity(body.quantity);
      const isInbound = body.transactionType === INVENTORY_TRANSACTION_TYPE.STOCK_IN;
      delta = isInbound ? quantity : -quantity;
      transactionType = body.transactionType;

      if (!isInbound && inventory.quantityAvailable < quantity) {
        throw AppError.conflict(
          `Only ${inventory.quantityAvailable} unit(s) are available to remove (${inventory.quantityReserved} are reserved for open orders)`
        );
      }

      await Inventory.update(
        {
          quantityAvailable: sequelize.literal(`quantity_available ${isInbound ? '+' : '-'} ${quantity}`),
          updatedBy: req.user.id,
        },
        { where: { id: inventory.id }, transaction }
      );
      await inventory.reload({ transaction });
    }

    if (body.reorderLevel !== undefined && body.reorderLevel !== null) {
      await inventory.update({ reorderLevel: body.reorderLevel, updatedBy: req.user.id }, { transaction });
    }

    await writeLedger({
      inventory,
      transactionType,
      quantity: Math.abs(delta),
      referenceType: INVENTORY_REFERENCE_TYPE.MANUAL,
      referenceId: null,
      notes: body.notes || `Manual ${transactionType.toLowerCase().replace('_', ' ')}`,
      actorId: req.user.id,
      transaction,
    });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.INVENTORY_ADJUSTED,
    entityType: 'Inventory',
    entityId: inventory.id,
    oldValues: before,
    newValues: {
      quantityAvailable: inventory.quantityAvailable,
      transactionType: body.transactionType,
      notes: body.notes || null,
    },
    req,
  });

  // Warn the store when a movement takes a line to or below its reorder level.
  if (inventory.quantityAvailable <= inventory.reorderLevel) {
    const vendor = await Vendor.findByPk(inventory.vendorId, { attributes: ['ownerUserId', 'businessName'] });
    if (vendor) {
      await notificationService.notify({
        userId: vendor.ownerUserId,
        templateCode: 'INVENTORY_LOW_STOCK',
        title: 'Low stock',
        message: `${inventory.variant?.product?.name || 'An item'} (${inventory.variant?.sku}) is down to ${inventory.quantityAvailable} unit(s).`,
        referenceType: 'Inventory',
        referenceId: inventory.id,
      });
    }
  }

  return detail({ id: inventory.id }, req);
}

/** Bulk stock-in, for a delivery from a distributor. */
async function bulkAdjust(body, req) {
  const results = [];
  const failures = [];

  for (const entry of body.items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const updated = await adjust(
        {
          id: entry.id,
          transactionType: body.transactionType,
          quantity: entry.quantity,
          reorderLevel: entry.reorderLevel,
          notes: body.notes,
        },
        req
      );
      results.push(updated);
    } catch (err) {
      // One bad line should not discard the whole delivery; report it instead.
      failures.push({ id: entry.id, message: err.message });
    }
  }

  return { updated: results.length, failed: failures.length, items: results, failures };
}

async function transactions(body, req) {
  const inventory = await Inventory.findByPk(body.id);
  if (!inventory) throw AppError.notFound('Inventory record not found');
  await vendorService.assertVendorAccess(inventory.vendorId, req);

  const { page, limit, offset, order } = buildPagination(body, {
    sortable: ['id', 'createdAt', 'transactionType'],
  });

  const where = { inventoryId: inventory.id };
  if (body.transactionType) where.transactionType = body.transactionType;
  if (body.referenceType) where.referenceType = body.referenceType;

  const result = await InventoryTransaction.findAndCountAll({ where, limit, offset, order });

  return { rows: result.rows.map(serializeTransaction), meta: toPageMeta(result, { page, limit }) };
}

/** Everything at or below its reorder level, for the vendor dashboard. */
async function lowStock(body, req) {
  const { page, limit, offset } = buildPagination(body, { sortable: SORTABLE });

  const where = { quantityAvailable: { [Op.lte]: sequelize.col('reorder_level') } };
  if (!(await scopeToVendor(body, req, where))) {
    return { rows: [], meta: { page, limit, total: 0 } };
  }

  const result = await Inventory.findAndCountAll({
    where,
    include: [{
      model: ProductVariant,
      as: 'variant',
      required: true,
      include: [{ model: Product, as: 'product', attributes: ['id', 'name', 'productType', 'status'] }],
    }],
    limit,
    offset,
    order: [['quantityAvailable', 'ASC']],
    distinct: true,
  });

  return { rows: result.rows.map(serialize), meta: toPageMeta(result, { page, limit }) };
}

/** Headline stock numbers for the vendor dashboard. */
async function summary(body, req) {
  const where = {};
  if (!(await scopeToVendor(body, req, where))) {
    return { totalSkus: 0, outOfStock: 0, lowStock: 0, unitsAvailable: 0, unitsReserved: 0 };
  }

  const [totalSkus, outOfStock, lowStockCount, totals] = await Promise.all([
    Inventory.count({ where }),
    Inventory.count({ where: { ...where, quantityAvailable: 0 } }),
    Inventory.count({ where: { ...where, quantityAvailable: { [Op.lte]: sequelize.col('reorder_level') } } }),
    Inventory.findOne({
      where,
      attributes: [
        [sequelize.fn('SUM', sequelize.col('quantity_available')), 'unitsAvailable'],
        [sequelize.fn('SUM', sequelize.col('quantity_reserved')), 'unitsReserved'],
      ],
      raw: true,
    }),
  ]);

  return {
    totalSkus,
    outOfStock,
    lowStock: lowStockCount,
    unitsAvailable: Number(totals?.unitsAvailable || 0),
    unitsReserved: Number(totals?.unitsReserved || 0),
  };
}

module.exports = {
  reserve,
  release,
  commitSale,
  returnStock,
  checkAvailability,
  list,
  detail,
  adjust,
  bulkAdjust,
  transactions,
  lowStock,
  summary,
  serialize,
  serializeTransaction,
  safeQuantity,
};
