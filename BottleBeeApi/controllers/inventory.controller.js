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
const {
  ok, paginated, updated, fail,
} = require('../utils/response');
const inventoryService = require('../services/inventory.service');
const vendorAccessService = require('../services/vendorAccess.service');
const notificationService = require('../services/notification.service');

/**
 * Manual stock management for vendors.
 *
 * Reserved stock is never touched here: it belongs to live orders, and the only
 * things allowed to move it are the checkout, cancellation, delivery and refund
 * flows via `services/inventory.service.js`. A vendor correcting their shelf
 * count must not be able to release units a customer has already paid for.
 */

const SORTABLE = ['id', 'quantityAvailable', 'quantityReserved', 'reorderLevel', 'updatedAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serialize = (inventory) => {
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
      ? {
        id: product.id, name: product.name, productType: product.productType, status: product.status,
      }
      : undefined,
  };
};

const serializeTransaction = (tx) => ({
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
});

const withRelations = {
  model: ProductVariant,
  as: 'variant',
  include: [{
    model: Product,
    as: 'product',
    attributes: ['id', 'name', 'productType', 'status'],
  }],
};

/**
 * Narrows a query to the vendors the caller may see.
 * Returns false when the caller belongs to no store at all, so the endpoint can
 * answer with an empty page rather than leaking another vendor's stock.
 */
async function scopeToVendor(body, req, where) {
  const isStaff = req.user.isSuperAdmin
    || req.user.roles.includes(ROLES.ADMIN)
    || req.user.roles.includes(ROLES.SUPPORT_AGENT);

  if (body.vendorId) {
    await vendorAccessService.assertVendorAccess(body.vendorId, req);
    where.vendorId = body.vendorId;
    return true;
  }

  if (!isStaff) {
    const ids = await vendorAccessService.myVendorIds(req);
    if (!ids.length) return false;
    where.vendorId = { [Op.in]: ids };
  }

  return true;
}

/**
 * Applies one manual movement inside a transaction and writes the ledger row.
 * Shared by `adjust` and `bulkAdjust` so a single line behaves identically
 * whether it arrives alone or in a batch.
 */
async function applyAdjustment({ inventory, body, actorId }) {
  const before = {
    quantityAvailable: inventory.quantityAvailable,
    quantityReserved: inventory.quantityReserved,
    reorderLevel: inventory.reorderLevel,
  };

  await sequelize.transaction(async (transaction) => {
    let movedQuantity;
    let transactionType;

    if (body.transactionType === INVENTORY_TRANSACTION_TYPE.ADJUSTMENT) {
      // Absolute set. A stock take counts what is physically on the shelf, which
      // excludes units already reserved for orders awaiting pickup.
      const target = Number(body.quantity);
      if (!Number.isInteger(target) || target < 0) {
        throw AppError.validation('An adjustment quantity must be zero or a positive whole number', [
          { field: 'quantity', message: 'Must be an integer of 0 or more' },
        ]);
      }

      movedQuantity = Math.abs(target - inventory.quantityAvailable);
      transactionType = INVENTORY_TRANSACTION_TYPE.ADJUSTMENT;

      await inventory.update({ quantityAvailable: target, updatedBy: actorId }, { transaction });
    } else {
      const quantity = inventoryService.safeQuantity(body.quantity);
      const isInbound = body.transactionType === INVENTORY_TRANSACTION_TYPE.STOCK_IN;

      if (!isInbound && inventory.quantityAvailable < quantity) {
        throw AppError.conflict(
          `Only ${inventory.quantityAvailable} unit(s) are available to remove (${inventory.quantityReserved} are reserved for open orders)`
        );
      }

      movedQuantity = quantity;
      transactionType = body.transactionType;

      await Inventory.update(
        {
          quantityAvailable: sequelize.literal(
            `quantity_available ${isInbound ? '+' : '-'} ${quantity}`
          ),
          updatedBy: actorId,
        },
        { where: { id: inventory.id }, transaction }
      );
      await inventory.reload({ transaction });
    }

    if (body.reorderLevel !== undefined && body.reorderLevel !== null) {
      await inventory.update({ reorderLevel: body.reorderLevel, updatedBy: actorId }, { transaction });
    }

    await inventoryService.writeLedger({
      inventory,
      transactionType,
      quantity: movedQuantity,
      referenceType: INVENTORY_REFERENCE_TYPE.MANUAL,
      referenceId: null,
      notes: body.notes || `Manual ${transactionType.toLowerCase().replace('_', ' ')}`,
      actorId,
      transaction,
    });
  });

  return before;
}

/** Tells the store owner when a movement takes a line to or below its reorder level. */
async function warnIfLowStock(inventory) {
  if (inventory.quantityAvailable > inventory.reorderLevel) return;

  const vendor = await Vendor.findByPk(inventory.vendorId, {
    attributes: ['ownerUserId', 'businessName'],
  });
  if (!vendor) return;

  await notificationService.notify({
    userId: vendor.ownerUserId,
    templateCode: 'INVENTORY_LOW_STOCK',
    title: 'Low stock',
    message: `${inventory.variant?.product?.name || 'An item'} (${inventory.variant?.sku}) is down to ${inventory.quantityAvailable} unit(s).`,
    referenceType: 'Inventory',
    referenceId: inventory.id,
  });
}

/* -------------------------------------------------------------------------- */
/*                             LIST STOCK LEVELS                              */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: SORTABLE,
      defaultSort: 'updatedAt',
    });

    const where = {};
    if (!(await scopeToVendor(req.body, req, where))) {
      return paginated(res, [], { page, limit, total: 0 }, 'Inventory fetched successfully');
    }

    if (req.body.lowStockOnly) {
      where.quantityAvailable = { [Op.lte]: sequelize.col('reorder_level') };
    }
    if (req.body.outOfStockOnly) where.quantityAvailable = 0;

    const variantWhere = {};
    if (req.body.search) variantWhere.sku = { [Op.like]: `%${req.body.search}%` };

    const result = await Inventory.findAndCountAll({
      where,
      include: [{
        ...withRelations,
        required: true,
        ...(Object.keys(variantWhere).length ? { where: variantWhere } : {}),
        include: [{
          model: Product,
          as: 'product',
          required: true,
          attributes: ['id', 'name', 'productType', 'status'],
          ...(req.body.productId ? { where: { id: req.body.productId } } : {}),
        }],
      }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map(serialize),
      toPageMeta(result, { page, limit }),
      'Inventory fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching inventory', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                         GET ONE INVENTORY RECORD                           */
/* -------------------------------------------------------------------------- */
const detail = async (req, res) => {
  try {
    const inventory = await Inventory.findByPk(req.body.id, { include: [withRelations] });
    if (!inventory) return fail(res, 'Inventory record not found', 404);

    await vendorAccessService.assertVendorAccess(inventory.vendorId, req);

    return ok(res, serialize(inventory), 'Inventory record fetched successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching inventory record', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          ADJUST STOCK FOR ONE SKU                          */
/* -------------------------------------------------------------------------- */
const adjust = async (req, res) => {
  try {
    const inventory = await Inventory.findByPk(req.body.id, { include: [withRelations] });
    if (!inventory) return fail(res, 'Inventory record not found', 404);

    await vendorAccessService.assertVendorAccess(inventory.vendorId, req, {
      requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER],
    });

    const before = await applyAdjustment({ inventory, body: req.body, actorId: req.user.id });

    await recordAudit({
      action: AUDIT_ACTIONS.INVENTORY_ADJUSTED,
      entityType: 'Inventory',
      entityId: inventory.id,
      oldValues: before,
      newValues: {
        quantityAvailable: inventory.quantityAvailable,
        transactionType: req.body.transactionType,
        notes: req.body.notes || null,
      },
      req,
    });

    await warnIfLowStock(inventory);

    return updated(res, serialize(inventory), 'Stock adjusted successfully');
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error adjusting stock', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       ADJUST MANY SKUs (DELIVERY IN)                       */
/* -------------------------------------------------------------------------- */
/**
 * Each line is applied independently. A single bad line is reported rather than
 * discarding a whole distributor delivery the vendor has already unpacked.
 */
const bulkAdjust = async (req, res) => {
  try {
    const items = [];
    const failures = [];

    for (const entry of req.body.items) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const inventory = await Inventory.findByPk(entry.id, { include: [withRelations] });
        if (!inventory) throw AppError.notFound('Inventory record not found');

        // eslint-disable-next-line no-await-in-loop
        await vendorAccessService.assertVendorAccess(inventory.vendorId, req, {
          requireRoles: [VENDOR_ROLE.OWNER, VENDOR_ROLE.MANAGER],
        });

        // eslint-disable-next-line no-await-in-loop
        const before = await applyAdjustment({
          inventory,
          body: {
            transactionType: req.body.transactionType,
            quantity: entry.quantity,
            reorderLevel: entry.reorderLevel,
            notes: req.body.notes,
          },
          actorId: req.user.id,
        });

        // eslint-disable-next-line no-await-in-loop
        await recordAudit({
          action: AUDIT_ACTIONS.INVENTORY_ADJUSTED,
          entityType: 'Inventory',
          entityId: inventory.id,
          oldValues: before,
          newValues: {
            quantityAvailable: inventory.quantityAvailable,
            transactionType: req.body.transactionType,
          },
          req,
        });

        // eslint-disable-next-line no-await-in-loop
        await warnIfLowStock(inventory);

        items.push(serialize(inventory));
      } catch (error) {
        failures.push({ id: entry.id, message: error.message });
      }
    }

    const message = failures.length
      ? `${items.length} record(s) updated, ${failures.length} failed`
      : `${items.length} record(s) updated successfully`;

    return updated(
      res,
      { updated: items.length, failed: failures.length, items, failures },
      message
    );
  } catch (error) {
    return fail(res, 'Error adjusting stock', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          MOVEMENT LEDGER FOR A SKU                         */
/* -------------------------------------------------------------------------- */
const transactions = async (req, res) => {
  try {
    const inventory = await Inventory.findByPk(req.body.id);
    if (!inventory) return fail(res, 'Inventory record not found', 404);

    await vendorAccessService.assertVendorAccess(inventory.vendorId, req);

    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: ['id', 'createdAt', 'transactionType'],
    });

    const where = { inventoryId: inventory.id };
    if (req.body.transactionType) where.transactionType = req.body.transactionType;
    if (req.body.referenceType) where.referenceType = req.body.referenceType;

    const result = await InventoryTransaction.findAndCountAll({ where, limit, offset, order });

    return paginated(
      res,
      result.rows.map(serializeTransaction),
      toPageMeta(result, { page, limit }),
      'Stock movements fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching stock movements', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                      ITEMS AT OR BELOW REORDER LEVEL                       */
/* -------------------------------------------------------------------------- */
const lowStock = async (req, res) => {
  try {
    const { page, limit, offset } = buildPagination(req.body, { sortable: SORTABLE });

    const where = { quantityAvailable: { [Op.lte]: sequelize.col('reorder_level') } };
    if (!(await scopeToVendor(req.body, req, where))) {
      return paginated(res, [], { page, limit, total: 0 }, 'Low stock items fetched successfully');
    }

    const result = await Inventory.findAndCountAll({
      where,
      include: [{ ...withRelations, required: true }],
      limit,
      offset,
      order: [['quantityAvailable', 'ASC']],
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map(serialize),
      toPageMeta(result, { page, limit }),
      'Low stock items fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching low stock items', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                          HEADLINE STOCK FIGURES                            */
/* -------------------------------------------------------------------------- */
const summary = async (req, res) => {
  try {
    const where = {};
    if (!(await scopeToVendor(req.body, req, where))) {
      return ok(
        res,
        { totalSkus: 0, outOfStock: 0, lowStock: 0, unitsAvailable: 0, unitsReserved: 0 },
        'Inventory summary fetched successfully'
      );
    }

    const [totalSkus, outOfStock, lowStockCount, totals] = await Promise.all([
      Inventory.count({ where }),
      Inventory.count({ where: { ...where, quantityAvailable: 0 } }),
      Inventory.count({
        where: { ...where, quantityAvailable: { [Op.lte]: sequelize.col('reorder_level') } },
      }),
      Inventory.findOne({
        where,
        attributes: [
          [sequelize.fn('SUM', sequelize.col('quantity_available')), 'unitsAvailable'],
          [sequelize.fn('SUM', sequelize.col('quantity_reserved')), 'unitsReserved'],
        ],
        raw: true,
      }),
    ]);

    return ok(
      res,
      {
        totalSkus,
        outOfStock,
        lowStock: lowStockCount,
        unitsAvailable: Number(totals?.unitsAvailable || 0),
        unitsReserved: Number(totals?.unitsReserved || 0),
      },
      'Inventory summary fetched successfully'
    );
  } catch (error) {
    if (error.statusCode) return fail(res, error.message, error.statusCode, error.errors);
    return fail(res, 'Error fetching inventory summary', 500, [{ message: error.message }]);
  }
};

module.exports = {
  list, detail, adjust, bulkAdjust, transactions, lowStock, summary, serialize, serializeTransaction,
};
