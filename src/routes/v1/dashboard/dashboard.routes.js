import express from "express";
import * as dashboardController from "../../../controllers/v1/dashboard/dashboard.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

/**
 * Dashboard Routes - The "Front Page Map"
 */

const router = express.Router();
router.use(authenticate);

/**
 * @route   GET /v1/dashboard/student
 * @desc    Get the current user's own student-dashboard summary
 * @access  Private (any authenticated user, self-scoped)
 */
router.get("/student", dashboardController.getStudentDashboardController);

/**
 * @route   GET /v1/dashboard/admin
 * @desc    Get platform-wide admin-dashboard summary
 * @access  Private (ADMIN or SUPER_ADMIN)
 */
router.get(
  "/admin",
  requirePermission(PERMISSIONS.USERS_VIEW),
  dashboardController.getAdminDashboardController,
);

export default router;
