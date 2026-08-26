'use strict';

const { Op } = require('sequelize');

const config = require('../config');
const {
  sequelize, AgeVerification, CustomerProfile, User,
} = require('../models');
const { VERIFICATION_STATUS, AUDIT_ACTIONS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { buildPagination, toPageMeta } = require('../utils/pagination');
const { hashDocumentNumber } = require('../utils/crypto');
const { recordAudit } = require('../utils/audit');
const { calculateAge, addDays } = require('../utils/dates');
const complianceService = require('./compliance.service');
const notificationService = require('./notification.service');

/**
 * Age verification (KYC).
 *
 * A customer cannot check out until an approved, unexpired verification exists.
 * The approved flag is denormalised onto customer_profiles.age_verified so
 * checkout is a single cheap read, and only this service writes it.
 *
 * Document numbers are never stored: only a keyed HMAC, so a reviewer can
 * detect the same document submitted twice without the number being readable.
 */

const SORTABLE = ['id', 'status', 'createdAt', 'reviewedAt'];

/** Approved verifications are re-checked after this long. */
const APPROVAL_VALIDITY_DAYS = 730;

function serialize(verification, { includeDocuments = false } = {}) {
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

  // Document images are only exposed to reviewers, never to list endpoints.
  if (includeDocuments) {
    base.documentFrontUrl = verification.documentFrontUrl;
    base.documentBackUrl = verification.documentBackUrl;
    base.selfieUrl = verification.selfieUrl;
  }

  return base;
}

/**
 * Submits documents for review.
 * @param {object} body   validated payload
 * @param {object} files  multer files keyed by field name
 */
async function submit(body, files, req) {
  const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });
  if (!profile) {
    throw AppError.businessRule('Create your customer profile before submitting age verification');
  }

  const pending = await AgeVerification.findOne({
    where: { userId: req.user.id, status: VERIFICATION_STATUS.PENDING },
  });
  if (pending) {
    throw AppError.conflict('You already have a verification awaiting review');
  }

  const approved = await AgeVerification.findOne({
    where: {
      userId: req.user.id,
      status: VERIFICATION_STATUS.APPROVED,
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }],
    },
  });
  if (approved) {
    throw AppError.conflict('Your identity is already verified');
  }

  // Reject an under-age submission immediately rather than queuing work a
  // reviewer would only have to reject.
  const minimumAge = config.compliance.defaultMinimumAge;
  const age = calculateAge(body.dateOfBirth);
  if (age === null || age < minimumAge) {
    throw AppError.compliance(
      `You must be at least ${minimumAge} years old to order on Bottle Bee.`,
      [{ code: 'UNDER_AGE', minimumAge, age }]
    );
  }

  if (String(body.dateOfBirth).slice(0, 10) !== String(profile.dateOfBirth).slice(0, 10)) {
    throw AppError.badRequest(
      'The date of birth on your document must match the one on your profile',
      [{ field: 'dateOfBirth', profileDateOfBirth: profile.dateOfBirth }]
    );
  }

  const verification = await AgeVerification.create({
    userId: req.user.id,
    documentType: body.documentType,
    documentNumberHash: hashDocumentNumber(body.documentNumber),
    documentFrontUrl: files?.documentFront || null,
    documentBackUrl: files?.documentBack || null,
    selfieUrl: files?.selfie || null,
    dateOfBirth: body.dateOfBirth,
    status: VERIFICATION_STATUS.PENDING,
    createdBy: req.user.id,
  });

  await recordAudit({
    action: AUDIT_ACTIONS.AGE_VERIFICATION_SUBMITTED,
    entityType: 'AgeVerification',
    entityId: verification.id,
    newValues: { documentType: body.documentType, dateOfBirth: body.dateOfBirth },
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

  return serialize(verification);
}

/** Current verification state for the signed-in user. */
async function myStatus(req) {
  const latest = await AgeVerification.findOne({
    where: { userId: req.user.id },
    order: [['createdAt', 'DESC']],
  });

  const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });

  return {
    ageVerified: !!profile?.ageVerified,
    ageVerifiedAt: profile?.ageVerifiedAt || null,
    canSubmit: !latest || [VERIFICATION_STATUS.REJECTED, VERIFICATION_STATUS.EXPIRED].includes(latest.status),
    latestVerification: latest ? serialize(latest) : null,
  };
}

async function list(body) {
  const { page, limit, offset, order } = buildPagination(body, { sortable: SORTABLE });

  const where = {};
  if (body.status) where.status = body.status;
  if (body.userId) where.userId = body.userId;

  const userWhere = {};
  if (body.search) {
    userWhere[Op.or] = [
      { firstName: { [Op.like]: `%${body.search}%` } },
      { lastName: { [Op.like]: `%${body.search}%` } },
      { email: { [Op.like]: `%${body.search}%` } },
      { phone: { [Op.like]: `%${body.search}%` } },
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

  return { rows: result.rows.map((v) => serialize(v)), meta: toPageMeta(result, { page, limit }) };
}

/** Full record including document images — reviewers only. */
async function detail(body) {
  const verification = await AgeVerification.findByPk(body.id, {
    include: [{ model: User, as: 'user' }],
  });
  if (!verification) throw AppError.notFound('Age verification not found');
  return serialize(verification, { includeDocuments: true });
}

/**
 * Approves or rejects a submission.
 * Approving stamps the customer profile so checkout can read a single flag;
 * rejecting leaves the profile unverified and tells the customer why.
 */
async function review(body, req) {
  const verification = await AgeVerification.findByPk(body.id, {
    include: [{ model: User, as: 'user' }],
  });
  if (!verification) throw AppError.notFound('Age verification not found');

  if (verification.status !== VERIFICATION_STATUS.PENDING) {
    throw AppError.businessRule(`This verification was already ${verification.status.toLowerCase()}`);
  }

  const approving = body.status === VERIFICATION_STATUS.APPROVED;

  if (!approving && !body.rejectionReason) {
    throw AppError.validation('A rejection reason is required', [
      { field: 'rejectionReason', message: 'Required when rejecting' },
    ]);
  }

  const previousStatus = verification.status;

  await sequelize.transaction(async (transaction) => {
    await verification.update(
      {
        status: body.status,
        rejectionReason: approving ? null : body.rejectionReason,
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
    oldValues: { status: previousStatus },
    newValues: { status: body.status, rejectionReason: body.rejectionReason || null },
    req,
  });

  await notificationService.notify({
    userId: verification.userId,
    templateCode: approving ? 'AGE_VERIFICATION_APPROVED' : 'AGE_VERIFICATION_REJECTED',
    title: approving ? 'Identity verified' : 'Verification needs attention',
    message: approving
      ? 'Your identity has been verified. You can now place orders on Bottle Bee.'
      : `We could not verify your documents: ${body.rejectionReason} Please submit again.`,
    referenceType: 'AgeVerification',
    referenceId: verification.id,
  });

  return serialize(verification, { includeDocuments: true });
}

/**
 * Expires approved verifications whose validity has lapsed and clears the
 * corresponding profile flags. Intended to be run on a schedule; exposed as an
 * admin action so it can also be triggered manually.
 */
async function expireLapsed(req) {
  const lapsed = await AgeVerification.findAll({
    where: {
      status: VERIFICATION_STATUS.APPROVED,
      expiresAt: { [Op.ne]: null, [Op.lt]: new Date() },
    },
  });

  if (!lapsed.length) return { expired: 0 };

  await sequelize.transaction(async (transaction) => {
    await AgeVerification.update(
      { status: VERIFICATION_STATUS.EXPIRED, updatedBy: req?.user?.id ?? null },
      { where: { id: { [Op.in]: lapsed.map((v) => v.id) } }, transaction }
    );

    await CustomerProfile.update(
      { ageVerified: false, ageVerifiedAt: null, updatedBy: req?.user?.id ?? null },
      { where: { userId: { [Op.in]: lapsed.map((v) => v.userId) } }, transaction }
    );
  });

  return { expired: lapsed.length, userIds: lapsed.map((v) => v.userId) };
}

/**
 * Whether this user may currently buy alcohol, and why not if they may not.
 * Used by the cart screen so the customer learns about a blocker before
 * reaching payment.
 */
async function eligibility(req) {
  const profile = await CustomerProfile.findOne({ where: { userId: req.user.id } });
  if (!profile) {
    return { eligible: false, reasons: [{ code: 'NO_PROFILE', message: 'Complete your profile first.' }] };
  }

  const report = await complianceService.evaluateOrder({
    address: null,
    dateOfBirth: profile.dateOfBirth,
    ageVerified: profile.ageVerified,
    totalQuantity: 0,
    grandTotal: 0,
    productTypes: [],
  });

  return {
    eligible: report.compliant,
    ageVerified: profile.ageVerified,
    reasons: report.violations,
    region: { code: report.regionCode, name: report.regionName },
  };
}

module.exports = {
  submit,
  myStatus,
  list,
  detail,
  review,
  expireLapsed,
  eligibility,
  serialize,
  APPROVAL_VALIDITY_DAYS,
};
