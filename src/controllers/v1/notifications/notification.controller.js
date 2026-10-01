import * as service from "../../../services/v1/notifications/notification.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Notifications & Promotions Controller
 */

const handle = (fn, message, status = 200) => async (req, res, next) => {
  try {
    return ApiResponse.send(res, (await fn(req, res)) ?? null, message, status);
  } catch (error) {
    next(error);
  }
};

// Student
export const getMine = handle((req) => service.getMyNotificationsService(req.user), "Notifications fetched successfully");
export const markRead = handle((req) => service.markReadService(req.user, req.params.id), "Marked as read");
export const markAllRead = handle((req) => service.markAllReadService(req.user), "All marked as read");
export const dismiss = handle((req) => service.dismissService(req.user, req.params.id), "Notification dismissed");

// Admin — notifications
export const list = handle((req) => service.listNotificationsService(req.query), "Notifications fetched successfully");
export const reach = handle((req) => service.getAudienceReachService(req.query), "Reach calculated");
export const emailQuota = handle(() => service.getEmailQuotaService(), "Email quota fetched");
export const create = handle((req) => service.createNotificationService(req.body, req.user.id), "Notification saved", 201);
export const update = handle((req) => service.updateNotificationService(req.params.id, req.body), "Notification saved");
export const publish = handle((req) => service.publishNotificationService(req.params.id, req.body, req.user.id), "Notification published");
export const archive = handle((req) => service.archiveNotificationService(req.params.id, req.user.id), "Notification archived");
export const remove = handle((req) => service.deleteNotificationService(req.params.id), "Notification deleted");

// Public + admin — promotions
export const activePromotion = handle((req, res) => {
  // The landing page asks on every visit; a short shared cache keeps the
  // database out of it however many visitors come.
  res.set("Cache-Control", "public, max-age=120");
  return service.getActivePromotionService();
}, "Promotion fetched");
export const listPromotions = handle((req) => service.listPromotionsService(req.query), "Promotions fetched successfully");
export const createPromotion = handle((req) => service.createPromotionService(req.body, req.user.id), "Promotion saved", 201);
export const updatePromotion = handle((req) => service.updatePromotionService(req.params.id, req.body, req.user.id), "Promotion saved");
export const publishPromotion = handle((req) => service.publishPromotionService(req.params.id, req.user.id), "Promotion published");
export const archivePromotion = handle((req) => service.archivePromotionService(req.params.id, req.user.id), "Promotion archived");
export const removePromotion = handle((req) => service.deletePromotionService(req.params.id, req.user.id), "Promotion deleted");

// Course interest ("Notify me") — student
export const getInterest = handle((req) => service.getInterestService(req.user, req.params.courseId), "Interest fetched");
export const addInterest = handle((req) => service.addInterestService(req.user, req.params.courseId), "You'll be notified");
export const removeInterest = handle((req) => service.removeInterestService(req.user, req.params.courseId), "Notification cancelled");
export const interestCount = handle((req) => service.getInterestCountService(req.params.courseId), "Interest count fetched");
