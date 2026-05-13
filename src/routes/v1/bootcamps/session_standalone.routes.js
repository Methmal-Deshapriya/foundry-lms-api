import express from "express";
import * as sessionController from "../../../controllers/v1/bootcamps/session.controller.js";
import * as progressController from "../../../controllers/v1/bootcamps/progress.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

const router = express.Router();

router.use(authenticate);

/**
 * Routes mounted on /v1/sessions
 */

router.get("/:id", sessionController.getSessionDetails);

router.patch(
  "/:id",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  sessionController.updateSession
);

router.delete(
  "/:id",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  sessionController.deleteSession
);

/**
 * Progress tracking
 */
router.post("/:id/complete", progressController.markComplete);
router.delete("/:id/complete", progressController.unmarkComplete);

export default router;
