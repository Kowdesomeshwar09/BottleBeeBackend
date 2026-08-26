'use strict';

const { Op } = require('sequelize');

const {
  Promotion, Category, Product, Vendor,
} = require('../models');
const { PROMOTION_TARGET_TYPE, COUPON_STATUS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const {
  ok, created, paginated, updated, deleted, fail,
} = require('../utils/response');

/**
 * Promotional banners for the storefront.
 *
 * A promotion points at a category, a product, a store, or nothing in
 * particular. The pointer is polymorphic — resolved by `targetType` — so there
 * is no foreign key on `target_id`; the active-banner endpoint resolves it and
 * returns the target inline, sparing the client a round trip per banner.
 *
 * Banners are presentation only. They carry no discount and cannot affect an
 * order total; anything that changes a price is a coupon.
 */

const SORTABLE = ['id', 'title', 'sortOrder', 'startsAt', 'endsAt', 'createdAt'];

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

const serialize = (promotion, extra = {}) => ({
  id: promotion.id,
  title: promotion.title,
  description: promotion.description,
  bannerUrl: promotion.bannerUrl,
  targetType: promotion.targetType,
  targetId: promotion.targetId,
  sortOrder: promotion.sortOrder,
  startsAt: promotion.startsAt,
  endsAt: promotion.endsAt,
  status: promotion.status,
  isActive: promotion.isActive,
  ...extra,
});

/** Resolves the polymorphic target so the client can deep-link immediately. */
async function resolveTarget(promotion) {
  if (!promotion.targetId || promotion.targetType === PROMOTION_TARGET_TYPE.ALL) return null;

  const lookups = {
    [PROMOTION_TARGET_TYPE.CATEGORY]: () => Category.findByPk(promotion.targetId, {
      attributes: ['id', 'name', 'slug'],
    }),
    [PROMOTION_TARGET_TYPE.PRODUCT]: () => Product.findByPk(promotion.targetId, {
      attributes: ['id', 'name', 'slug', 'vendorId'],
    }),
    [PROMOTION_TARGET_TYPE.VENDOR]: () => Vendor.findByPk(promotion.targetId, {
      attributes: ['id', 'businessName'],
    }),
  };

  const lookup = lookups[promotion.targetType];
  if (!lookup) return null;

  const target = await lookup();
  return target ? target.toJSON() : null;
}

/* -------------------------------------------------------------------------- */
/*                             LIST PROMOTIONS                                */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, {
      sortable: SORTABLE,
      defaultSort: 'sortOrder',
      defaultOrder: 'ASC',
    });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.targetType) where.targetType = req.body.targetType;

    if (req.body.activeNow) {
      const now = new Date();
      where.status = COUPON_STATUS.ACTIVE;
      where.startsAt = { [Op.lte]: now };
      where.endsAt = { [Op.gte]: now };
    }

    if (req.body.search) where.title = { [Op.like]: `%${req.body.search}%` };

    const result = await Promotion.findAndCountAll({ where, limit, offset, order });

    return paginated(
      res,
      result.rows.map((p) => serialize(p)),
      toPageMeta(result, { page, limit }),
      'Promotions fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching promotions', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                     LIVE BANNERS FOR THE STOREFRONT                        */
/* -------------------------------------------------------------------------- */
const active = async (req, res) => {
  try {
    const now = new Date();

    const promotions = await Promotion.findAll({
      where: {
        status: COUPON_STATUS.ACTIVE,
        isActive: true,
        startsAt: { [Op.lte]: now },
        endsAt: { [Op.gte]: now },
      },
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']],
      limit: 20,
    });

    const withTargets = await Promise.all(
      promotions.map(async (promotion) => serialize(promotion, {
        target: await resolveTarget(promotion),
      }))
    );

    return ok(res, withTargets, 'Active promotions fetched successfully');
  } catch (error) {
    return fail(res, 'Error fetching active promotions', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                     CREATE OR UPDATE A PROMOTION                           */
/* -------------------------------------------------------------------------- */
const save = async (req, res) => {
  try {
    if (req.body.targetType !== PROMOTION_TARGET_TYPE.ALL && !req.body.targetId) {
      return fail(res, 'A target id is required for this target type', 422, [
        { field: 'targetId', message: `Required when targetType is ${req.body.targetType}` },
      ]);
    }

    const existing = req.body.id ? await Promotion.findByPk(req.body.id) : null;
    if (req.body.id && !existing) return fail(res, 'Promotion not found', 404);

    const values = {
      title: req.body.title,
      description: req.body.description || null,
      bannerUrl: req.body.bannerUrl || null,
      targetType: req.body.targetType,
      targetId: req.body.targetType === PROMOTION_TARGET_TYPE.ALL ? null : req.body.targetId,
      sortOrder: req.body.sortOrder ?? 0,
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt,
      status: req.body.status || COUPON_STATUS.ACTIVE,
    };

    if (existing) {
      await existing.update({
        ...values,
        isActive: req.body.isActive ?? existing.isActive,
        updatedBy: req.user.id,
      });
      return updated(res, serialize(existing), 'Promotion updated successfully');
    }

    const promotion = await Promotion.create({ ...values, createdBy: req.user.id });
    return created(res, serialize(promotion), 'Promotion created successfully');
  } catch (error) {
    return fail(res, 'Error saving promotion', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                           DELETE A PROMOTION                               */
/* -------------------------------------------------------------------------- */
const remove = async (req, res) => {
  try {
    const promotion = await Promotion.findByPk(req.body.id);
    if (!promotion) return fail(res, 'Promotion not found', 404);

    await promotion.update({ isActive: false, deletedBy: req.user.id });
    await promotion.destroy();

    return deleted(res, 'Promotion deleted successfully');
  } catch (error) {
    return fail(res, 'Error deleting promotion', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                    EXPIRE PROMOTIONS PAST THEIR WINDOW                     */
/* -------------------------------------------------------------------------- */
const expireLapsed = async (req, res) => {
  try {
    const [expired] = await Promotion.update(
      { status: COUPON_STATUS.EXPIRED, updatedBy: req.user.id },
      { where: { status: COUPON_STATUS.ACTIVE, endsAt: { [Op.lt]: new Date() } } }
    );

    return ok(res, { promotionsExpired: expired }, 'Lapsed promotions expired');
  } catch (error) {
    return fail(res, 'Error expiring promotions', 500, [{ message: error.message }]);
  }
};

module.exports = { list, active, save, remove, expireLapsed, serialize };
