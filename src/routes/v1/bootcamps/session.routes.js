import express from "express";
import * as sessionController from "../../../controllers/v1/bootcamps/session.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

const router = express.Router({ mergeParams: true });

// All session routes require authentication
router.use(authenticate);

/**
 * Routes mounted on /v1/bootcamps/:bootcampId/sessions
 */

router.get("/", sessionController.getBootcampSessions);

router.post(
  "/",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  sessionController.createSession
);

router.patch(
  "/reorder",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  sessionController.reorderSessions
);

export default router;
