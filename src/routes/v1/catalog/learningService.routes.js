import express from "express";
import { getAdminLearningServiceSummaries } from "../../../controllers/v1/catalog/learningServiceSummary.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);

router.get(
  "/summary",
  requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN),
  getAdminLearningServiceSummaries,
);

export default router;
