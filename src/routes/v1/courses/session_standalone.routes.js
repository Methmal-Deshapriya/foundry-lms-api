import express from "express";
import * as sessionController from "../../../controllers/v1/courses/session.controller.js";
import * as progressController from "../../../controllers/v1/courses/progress.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();

router.use(authenticate);

/**
 * Routes mounted on /v1/sessions
 */

router.get("/:id", sessionController.getSessionDetails);

router.patch(
  "/:id",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE),
  sessionController.updateSession
);

router.delete(
  "/:id",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE),
  sessionController.deleteSession
);

/**
 * Progress tracking
 */
router.post("/:id/complete", progressController.markComplete);
router.delete("/:id/complete", progressController.unmarkComplete);

export default router;
