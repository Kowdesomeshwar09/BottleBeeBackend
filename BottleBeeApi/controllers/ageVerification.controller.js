'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const { sequelize, AgeVerification, CustomerProfile, User } = require('../models');
const { VERIFICATION_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { hashDocumentNumber } = require('../utils/crypto');
const { recordAudit } = require('../utils/audit');
const { calculateAge, addDays } = require('../utils/dates');
const { publicUrl } = require('../middlewares/upload');
const {
  ok, created, paginated, updated, fail,
} = require('../utils/response');
const complianceService = require('../services/compliance.service');
const notificationService = require('../services/notification.service');

/**
 * Age verification (KYC).
 *
 * A customer cannot check out until an approved, unexpired verification exists.
 * The approved flag is denormalised onto `customer_profiles.age_verified` so
 * checkout is a single cheap read, and this module is the only writer of it.
 *
 * Document numbers are never stored in the clear — only a keyed HMAC, so a
 * reviewer can detect the same document submitted twice without the number
 * itself being readable from the database.
 */

const SORTABLE = ['id', 'status', 'createdAt', 'reviewedAt'];

/** How long an approval stands before re-verification is required. */
const APPROVAL_VALIDITY_DAYS = 730;

/* -------------------------------------------------------------------------- */
/*                          HELPERS (module-private)                          */
/* -------------------------------------------------------------------------- */

/**
 * Document images are exposed only to reviewers, so `includeDocuments` is opt-in
 * and never set on a list response.
 */
const serialize = (verification, { includeDocuments = false } = {}) => {
  const base = {
    id: verification.id,
    userId: verification.userId,
    documentType: verification.documentType,
    dateOfBirth: verification.dateOfBirth,
    status: verification.status,
    rejectionReason: verification.rejectionReason,
    reviewedBy: verification.reviewedBy,
    reviewedAt: verification.reviewedAt,
    expiresAt: verification.expiresAt,
    createdAt: verification.createdAt,
    user: verification.user
      ? {
        id: verification.user.id,
        firstName: verification.user.firstName,
        lastName: verification.user.lastName,
        email: verification.user.email,
        phone: verification.user.phone,
      }
      : undefined,
  };

  if (includeDocuments) {
    base.documentFrontUrl = verification.documentFrontUrl;
    base.documentBackUrl = verification.documentBackUrl;
    base.selfieUrl = verification.selfieUrl;
  }

  return base;
};

/** Maps multer's `fields` output to the public URLs stored on the record. */
const collectFiles = (req) => {
  const files = req.files || {};
  return {
    documentFront: publicUrl(files.documentFront?.[0]),
    documentBack: publicUrl(files.documentBack?.[0]),
    selfie: publicUrl(files.selfie?.[0]),
  };
};

/* -------------------------------------------------------------------------- */
/*                        SUBMIT DOCUMENTS FOR REVIEW                         */
/* -------------------------------------------------------------------------- */
const submit = async (req, res) => {
  try {
    const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });
    if (!profile) {
      return fail(res, 'Create your customer profile before submitting age verification', 409);
    }

    const pending = await AgeVerification.findOne({
      where: { userId: req.user.id, status: VERIFICATION_STATUS.PENDING },
    });
    if (pending) return fail(res, 'You already have a verification awaiting review', 409);

    const approved = await AgeVerification.findOne({
      where: {
        userId: req.user.id,
        status: VERIFICATION_STATUS.APPROVED,
        [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
      },
    });
    if (approved) return fail(res, 'Your identity is already verified', 409);

    // Reject an under-age submission outright rather than queuing work a
    // reviewer could only ever reject.
    const minimumAge = config.compliance.defaultMinimumAge;
    const age = calculateAge(req.body.dateOfBirth);

    if (age === null || age < minimumAge) {
      return fail(
        res,
        `You must be at least ${minimumAge} years old to order on Bottle Bee.`,
        403,
        [{ code: 'UNDER_AGE', minimumAge, age }]
      );
    }

    // The document must corroborate the profile, not contradict it.
    if (String(req.body.dateOfBirth).slice(0, 10) !== String(profile.dateOfBirth).slice(0, 10)) {
      return fail(
        res,
        'The date of birth on your document must match the one on your profile',
        400,
        [{ field: 'dateOfBirth', profileDateOfBirth: profile.dateOfBirth }]
      );
    }

    const files = collectFiles(req);

    const verification = await AgeVerification.create({
      userId: req.user.id,
      documentType: req.body.documentType,
      documentNumberHash: hashDocumentNumber(req.body.documentNumber),
      documentFrontUrl: files.documentFront,
      documentBackUrl: files.documentBack,
      selfieUrl: files.selfie,
      dateOfBirth: req.body.dateOfBirth,
      status: VERIFICATION_STATUS.PENDING,
      createdBy: req.user.id,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.AGE_VERIFICATION_SUBMITTED,
      entityType: 'AgeVerification',
      entityId: verification.id,
      newValues: { documentType: req.body.documentType, dateOfBirth: req.body.dateOfBirth },
      req,
    });

    await notificationService.notify({
      userId: req.user.id,
      templateCode: 'AGE_VERIFICATION_SUBMITTED',
      title: 'Verification submitted',
      message: 'We have received your documents. Verification usually completes within a few hours.',
      referenceType: 'AgeVerification',
      referenceId: verification.id,
    });

    return created(res, serialize(verification), 'Documents submitted for verification');
  } catch (error) {
    return fail(res, 'Error submitting documents', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            MY VERIFICATION STATE                           */
/* -------------------------------------------------------------------------- */
const myStatus = async (req, res) => {
  try {
    const latest = await AgeVerification.findOne({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
    });

    const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });

    return ok(
      res,
      {
        ageVerified: !!profile?.ageVerified,
        ageVerifiedAt: profile?.ageVerifiedAt || null,
        canSubmit: !latest
          || [VERIFICATION_STATUS.REJECTED, VERIFICATION_STATUS.EXPIRED].includes(latest.status),
        latestVerification: latest ? serialize(latest) : null,
      },
      'Verification status fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching verification status', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                            AM I ELIGIBLE TO BUY?                           */
/* -------------------------------------------------------------------------- */
/**
 * Returns every blocking reason at once, so the cart can explain the problem
 * before the customer reaches payment rather than failing at checkout.
 */
const eligibility = async (req, res) => {
  try {
    const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });

    if (!profile) {
      return ok(
        res,
        {
          eligible: false,
          ageVerified: false,
          reasons: [{ code: 'NO_PROFILE', message: 'Complete your profile first.' }],
        },
        'Eligibility checked successfully'
      );
    }

    const report = await complianceService.evaluateOrder({
      address: null,
      dateOfBirth: profile.dateOfBirth,
      ageVerified: profile.ageVerified,
      totalQuantity: 0,
      grandTotal: 0,
      productTypes: [],
    });

    return ok(
      res,
      {
        eligible: report.compliant,
        ageVerified: profile.ageVerified,
        reasons: report.violations,
        region: { code: report.regionCode, name: report.regionName },
      },
      'Eligibility checked successfully'
    );
  } catch (error) {
    return fail(res, 'Error checking eligibility', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       LIST SUBMISSIONS FOR REVIEW                          */
/* -------------------------------------------------------------------------- */
const list = async (req, res) => {
  try {
    const { page, limit, offset, order } = buildPagination(req.body, { sortable: SORTABLE });

    const where = {};
    if (req.body.status) where.status = req.body.status;
    if (req.body.userId) where.userId = req.body.userId;

    const userWhere = {};
    if (req.body.search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${req.body.search}%` } },
        { lastName: { [Op.like]: `%${req.body.search}%` } },
        { email: { [Op.like]: `%${req.body.search}%` } },
        { phone: { [Op.like]: `%${req.body.search}%` } },
      ];
    }

    const result = await AgeVerification.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'user',
        required: true,
        ...(Object.keys(userWhere).length ? { where: userWhere } : {}),
      }],
      limit,
      offset,
      order,
      distinct: true,
    });

    return paginated(
      res,
      result.rows.map((v) => serialize(v)),
      toPageMeta(result, { page, limit }),
      'Verifications fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching verifications', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                     GET ONE SUBMISSION WITH DOCUMENTS                      */
/* -------------------------------------------------------------------------- */
/** Every access is audited: these are customer identity documents. */
const detail = async (req, res) => {
  try {
    const verification = await AgeVerification.findByPk(req.body.id, {
      include: [{ model: User, as: 'user' }],
    });
    if (!verification) return fail(res, 'Age verification not found', 404);

    await recordAudit({
      action: AUDIT_ACTIONS.AGE_VERIFICATION_REVIEWED,
      entityType: 'AgeVerification',
      entityId: verification.id,
      newValues: { action: 'DOCUMENTS_VIEWED' },
      req,
    });

    return ok(
      res,
      serialize(verification, { includeDocuments: true }),
      'Verification fetched successfully'
    );
  } catch (error) {
    return fail(res, 'Error fetching verification', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                       APPROVE OR REJECT A SUBMISSION                       */
/* -------------------------------------------------------------------------- */
/**
 * Approving stamps the customer profile so checkout can read one flag, and sets
 * a re-verification date. Both writes happen in one transaction: a profile
 * marked verified without a corresponding approved record would be a compliance
 * hole, and the reverse would silently block a verified customer.
 */
const review = async (req, res) => {
  try {
    const verification = await AgeVerification.findByPk(req.body.id, {
      include: [{ model: User, as: 'user' }],
    });
    if (!verification) return fail(res, 'Age verification not found', 404);

    if (verification.status !== VERIFICATION_STATUS.PENDING) {
      return fail(
        res,
        `This verification was already ${verification.status.toLowerCase()}`,
        409
      );
    }

    const approving = req.body.status === VERIFICATION_STATUS.APPROVED;
    if (!approving && !req.body.rejectionReason) {
      return fail(res, 'A rejection reason is required', 422, [
        { field: 'rejectionReason', message: 'Required when rejecting' },
      ]);
    }

    await sequelize.transaction(async (transaction) => {
      await verification.update(
        {
          status: req.body.status,
          rejectionReason: approving ? null : req.body.rejectionReason,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          expiresAt: approving ? addDays(new Date(), APPROVAL_VALIDITY_DAYS) : null,
          updatedBy: req.user.id,
        },
        { transaction }
      );

      const profile = await CustomerProfile.findOne({
        where: { userId: verification.userId },
        transaction,
      });

      if (profile) {
        await profile.update(
          {
            ageVerified: approving,
            ageVerifiedAt: approving ? new Date() : null,
            updatedBy: req.user.id,
          },
          { transaction }
        );
      }
    });

    await recordAudit({
      action: AUDIT_ACTIONS.AGE_VERIFICATION_REVIEWED,
      entityType: 'AgeVerification',
      entityId: verification.id,
      oldValues: { status: VERIFICATION_STATUS.PENDING },
      newValues: {
        status: req.body.status,
        rejectionReason: req.body.rejectionReason || null,
      },
      req,
    });

    await notificationService.notify({
      userId: verification.userId,
      templateCode: approving ? 'AGE_VERIFICATION_APPROVED' : 'AGE_VERIFICATION_REJECTED',
      title: approving ? 'Identity verified' : 'Verification needs attention',
      message: approving
        ? 'Your identity has been verified. You can now place orders on Bottle Bee.'
        : `We could not verify your documents: ${req.body.rejectionReason} Please submit again.`,
      referenceType: 'AgeVerification',
      referenceId: verification.id,
    });

    return updated(
      res,
      serialize(verification, { includeDocuments: true }),
      `Verification ${req.body.status.toLowerCase()} successfully`
    );
  } catch (error) {
    return fail(res, 'Error reviewing verification', 500, [{ message: error.message }]);
  }
};

/* -------------------------------------------------------------------------- */
/*                        EXPIRE LAPSED VERIFICATIONS                         */
/* -------------------------------------------------------------------------- */
/**
 * Marks approvals past their validity date EXPIRED and clears the matching
 * profile flags, so those customers must re-verify before ordering again.
 * Intended for a scheduled job; exposed so it can also be run on demand.
 */
const expireLapsed = async (req, res) => {
  try {
    const lapsed = await AgeVerification.findAll({
      where: {
        status: VERIFICATION_STATUS.APPROVED,
        expiresAt: { [Op.ne]: null, [Op.lt]: new Date() },
      },
    });

    if (!lapsed.length) return ok(res, { expired: 0 }, 'No lapsed verifications found');

    await sequelize.transaction(async (transaction) => {
      await AgeVerification.update(
        { status: VERIFICATION_STATUS.EXPIRED, updatedBy: req.user.id },
        { where: { id: { [Op.in]: lapsed.map((v) => v.id) } }, transaction }
      );

      await CustomerProfile.update(
        { ageVerified: false, ageVerifiedAt: null, updatedBy: req.user.id },
        { where: { userId: { [Op.in]: lapsed.map((v) => v.userId) } }, transaction }
      );
    });

    return ok(
      res,
      { expired: lapsed.length, userIds: lapsed.map((v) => v.userId) },
      'Lapsed verifications expired'
    );
  } catch (error) {
    return fail(res, 'Error expiring verifications', 500, [{ message: error.message }]);
  }
};

module.exports = {
  submit,
  myStatus,
  eligibility,
  list,
  detail,
  review,
  expireLapsed,
  serialize,
  APPROVAL_VALIDITY_DAYS,
};
