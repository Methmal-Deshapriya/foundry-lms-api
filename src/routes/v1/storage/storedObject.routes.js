import express from "express";
import * as controller from "../../../controllers/v1/storage/storedObject.controller.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireAnyPermission, requirePermission } from "../../../middlewares/requirePermission.js";

const router = express.Router();
router.use(authenticate);

// Most purposes here are admin-only (STORAGE_MANAGE), but project thumbnails
// are uploaded by the student themselves — so these two routes admit either
// permission, and the purpose/ownership-specific check happens inside the
// service (a student can only create/complete a PROJECT_THUMBNAIL upload,
// never a course/session one). Object access (signed private downloads)
// stays admin-only — a project thumbnail never needs it, it's public.
router.post(
  "/uploads",
  requireAnyPermission(PERMISSIONS.STORAGE_MANAGE, PERMISSIONS.PROJECTS_SUBMIT),
  controller.createUploadIntent,
);
router.post(
  "/uploads/:id/complete",
  requireAnyPermission(PERMISSIONS.STORAGE_MANAGE, PERMISSIONS.PROJECTS_SUBMIT),
  controller.completeUpload,
);
router.get("/objects/:id/access", requirePermission(PERMISSIONS.STORAGE_MANAGE), controller.getObjectAccess);

export default router;
