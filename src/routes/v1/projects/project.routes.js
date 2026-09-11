import express from "express";
import * as projectController from "../../../controllers/v1/projects/project.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import {
  requireAnyPermission,
  requirePermission,
} from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();

/**
 * Public Routes (Showcase)
 */
router.get("/showcase", projectController.getPublicShowcase);
router.get("/showcase/:id", projectController.getPublicProjectDetails);

/**
 * Protected Routes
 */
router.use(authenticate);

// Student routes
router.post(
  "/",
  requirePermission(PERMISSIONS.PROJECTS_SUBMIT),
  projectController.submitProject,
);
router.get(
  "/my",
  requirePermission(PERMISSIONS.PROJECTS_VIEW_OWN),
  projectController.getMyProjects,
);
router.get(
  "/:id",
  requireAnyPermission(
    PERMISSIONS.PROJECTS_VIEW_OWN,
    PERMISSIONS.PROJECTS_REVIEW,
  ),
  projectController.getProjectDetails,
);
router.patch(
  "/:id",
  requirePermission(PERMISSIONS.PROJECTS_EDIT_OWN),
  projectController.updateProject,
);

// Admin routes
router.get(
  "/admin/all",
  requirePermission(PERMISSIONS.PROJECTS_REVIEW),
  projectController.getAllProjectsAdmin
);

router.patch(
  "/:id/review",
  requirePermission(PERMISSIONS.PROJECTS_REVIEW),
  projectController.reviewProject
);

export default router;
