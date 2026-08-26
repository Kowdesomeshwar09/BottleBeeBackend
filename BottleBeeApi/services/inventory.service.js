'use strict';

const { Op } = require('sequelize');

const {
  sequelize, Inventory, InventoryTransaction, ProductVariant, Product,
} = require('../models');
const { INVENTORY_TRANSACTION_TYPE, INVENTORY_REFERENCE_TYPE } = require('../config/constants');
const AppError = require('../utils/AppError');

/**
 * Inventory movement primitives — SHARED SERVICE.
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
 * These four live here rather than in a controller because the order, payment,
 * delivery and refund controllers all drive them, and every one of them must
 * behave identically. Manual stock management — list, adjust, ledger, low stock
 * — lives in `inventory.controller.js`.
 *
 * Concurrency: each movement is a single conditional UPDATE guarded on the
 * current balance. Two simultaneous checkouts for the last bottle cannot both
 * succeed — whichever loses the race matches zero rows and is rejected, rather
 * than both reading "1 available" and both decrementing.
 *
 * Every function here requires the caller's transaction. A stock movement that
 * committed independently of the order it belongs to would be exactly the bug
 * this design exists to prevent.
 */

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

/** Writes a ledger row carrying the balances immediately after the movement. */
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

/**
 * Moves stock from available to reserved.
 *
 * @param {Array<{productVariantId:number, quantity:number}>} items
 * @param {object} options
 * @param {number} options.vendorId
 * @param {number} [options.orderId]   ledger reference
 * @param {number} [options.actorId]
 * @param {object} options.transaction REQUIRED
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

    // The WHERE clause is the concurrency guard, not the read above.
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

    // Never release more than is actually held, even if an order row disagrees:
    // over-releasing would invent stock that does not exist.
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

    released.push({
      inventoryId: inventory.id,
      productVariantId: item.productVariantId,
      quantity: releasable,
    });
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

    sold.push({
      inventoryId: inventory.id,
      productVariantId: item.productVariantId,
      quantity: sellable,
    });
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
 * Read-only availability check, so the cart can warn a customer before checkout
 * instead of failing mid-transaction. Advisory only — `reserve` is the authority.
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

module.exports = {
  reserve,
  release,
  commitSale,
  returnStock,
  checkAvailability,
  writeLedger,
  safeQuantity,
};
