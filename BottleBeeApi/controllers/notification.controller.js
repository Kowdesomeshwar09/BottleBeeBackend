'use strict';

const service = require('../services/notification.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, paginated, updated, deleted } = require('../utils/response');

const list = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.list(req.body, req);
  return paginated(res, rows, meta, 'Notifications fetched successfully');
});

const unreadCount = asyncHandler(async (req, res) => {
  const result = await service.unreadCount(req);
  return ok(res, result, 'Unread count fetched successfully');
});

const markRead = asyncHandler(async (req, res) => {
  const result = await service.markRead(req.body, req);
  return updated(res, result, 'Notification marked as read');
});

const markAllRead = asyncHandler(async (req, res) => {
  const result = await service.markAllRead(req);
  return updated(res, result, 'All notifications marked as read');
});

const sendSystem = asyncHandler(async (req, res) => {
  const result = await service.sendSystem(req.body, req);
  return ok(res, result, 'Notification sent successfully');
});

const listTemplates = asyncHandler(async (req, res) => {
  const { rows, meta } = await service.listTemplates(req.body, req);
  return paginated(res, rows, meta, 'Templates fetched successfully');
});

const saveTemplate = asyncHandler(async (req, res) => {
  const result = await service.saveTemplate(req.body, req);
  return updated(res, result, 'Template saved successfully');
});

const deleteTemplate = asyncHandler(async (req, res) => {
  await service.deleteTemplate(req.body, req);
  return deleted(res, 'Template deleted successfully');
});

const previewTemplate = asyncHandler(async (req, res) => {
  const result = await service.previewTemplate(req.body, req);
  return ok(res, result, 'Template rendered successfully');
});

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  sendSystem,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  previewTemplate,
};
