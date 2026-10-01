import express from "express";
import * as profileController from "../../../controllers/v1/profiles/profile.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();

/**
 * Public Route — a published student's portfolio page.
 */
router.get("/public/:slug", profileController.getPublicProfile);

/**
 * Own profile — students only. Gated by PROJECTS_SUBMIT: public profiles
 * exist for students who submit projects, and that permission is exactly
 * "a student who can submit projects".
 */
router.use(authenticate);
router.get("/me", requirePermission(PERMISSIONS.PROJECTS_SUBMIT), profileController.getMyProfile);
router.put("/me", requirePermission(PERMISSIONS.PROJECTS_SUBMIT), profileController.saveMyProfile);
// Show / hide the public page (withdraw consent) — code review M08-01.
router.post("/me/publish", requirePermission(PERMISSIONS.PROJECTS_SUBMIT), profileController.publishMyProfile);
router.delete("/me/publish", requirePermission(PERMISSIONS.PROJECTS_SUBMIT), profileController.unpublishMyProfile);

export default router;
