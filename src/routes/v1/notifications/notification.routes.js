import express from "express";
import * as controller from "../../../controllers/v1/notifications/notification.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

// Mounted at /api/v1/notifications. Promotions live here too, since the same
// admins manage both from one screen.
const router = express.Router();

// Public — the landing page's floating banner.
router.get("/promotions/active", controller.activePromotion);

router.use(authenticate);

// Signed-in student
router.get("/me", controller.getMine);
router.post("/me/read-all", controller.markAllRead);
router.post("/me/:id/read", controller.markRead);
router.post("/me/:id/dismiss", controller.dismiss);

// "Notify me when it opens" (students)
router.get("/interests/:courseId", controller.getInterest);
router.post("/interests/:courseId", controller.addInterest);
router.delete("/interests/:courseId", controller.removeInterest);

// Admins (every admin — NOTIFICATIONS_MANAGE)
const manage = requirePermission(PERMISSIONS.NOTIFICATIONS_MANAGE);
router.get("/admin/promotions", manage, controller.listPromotions);
router.post("/admin/promotions", manage, controller.createPromotion);
router.put("/admin/promotions/:id", manage, controller.updatePromotion);
router.post("/admin/promotions/:id/publish", manage, controller.publishPromotion);
router.post("/admin/promotions/:id/archive", manage, controller.archivePromotion);
router.delete("/admin/promotions/:id", manage, controller.removePromotion);

router.get("/admin", manage, controller.list);
router.get("/admin/reach", manage, controller.reach);
router.get("/admin/email-quota", manage, controller.emailQuota);
router.get("/admin/interests/:courseId", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), controller.interestCount);
router.post("/admin", manage, controller.create);
router.put("/admin/:id", manage, controller.update);
router.post("/admin/:id/publish", manage, controller.publish);
router.post("/admin/:id/archive", manage, controller.archive);
router.delete("/admin/:id", manage, controller.remove);

export default router;
