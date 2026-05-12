import express from "express";
import * as projectController from "../../../controllers/v1/projects/project.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

const router = express.Router();

/**
 * Public Routes (Showcase)
 */
router.get("/showcase", projectController.getPublicShowcase);
router.get("/showcase/:id", projectController.getProjectDetails);

/**
 * Protected Routes
 */
router.use(authenticate);

// Student routes
router.post("/", projectController.submitProject);
router.get("/my", projectController.getMyProjects);
router.get("/:id", projectController.getProjectDetails);
router.patch("/:id", projectController.updateProject);

// Admin routes
router.get(
  "/admin/all",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  projectController.getAllProjectsAdmin
);

router.patch(
  "/:id/review",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  projectController.reviewProject
);

export default router;
