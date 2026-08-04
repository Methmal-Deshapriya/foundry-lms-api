import express from "express";
import * as sessionController from "../../../controllers/v1/courses/session.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router({ mergeParams: true });

// All session routes require authentication
router.use(authenticate);

/**
 * Routes mounted on /v1/courses/:courseId/sessions
 */

router.get("/", sessionController.getCourseSessions);

router.post(
  "/",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE),
  sessionController.createSession
);

router.patch(
  "/reorder",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE),
  sessionController.reorderSessions
);

export default router;
