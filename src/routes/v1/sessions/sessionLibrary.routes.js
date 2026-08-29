import express from "express";
import * as sessionController from "../../../controllers/v1/sessions/sessionLibrary.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.SESSIONS_VIEW_LIBRARY),
  sessionController.listSessions,
);
router.post(
  "/",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE_LIBRARY),
  sessionController.createSession,
);
router.post(
  "/bulk-archive",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE_LIBRARY),
  sessionController.bulkArchiveSessions,
);
router.get(
  "/:id",
  requirePermission(PERMISSIONS.SESSIONS_VIEW_LIBRARY),
  sessionController.getSession,
);
router.patch(
  "/:id",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE_LIBRARY),
  sessionController.updateSession,
);
router.patch(
  "/:id/archive",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE_LIBRARY),
  sessionController.archiveSession,
);
router.patch(
  "/:id/unarchive",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE_LIBRARY),
  sessionController.unarchiveSession,
);
router.post(
  "/:id/duplicate",
  requirePermission(PERMISSIONS.SESSIONS_MANAGE_LIBRARY),
  sessionController.duplicateSession,
);
router.delete(
  "/:id",
  requirePermission(PERMISSIONS.SESSIONS_DELETE_PERMANENTLY),
  sessionController.deleteSessionPermanently,
);

export default router;

