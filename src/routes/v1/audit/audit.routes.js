import express from "express";
import * as auditController from "../../../controllers/v1/audit/audit.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

/**
 * Audit Routes - The "Security Vault"
 * Maps HTTP addresses to system accountability logs.
 * Restricted to Super Administrators only.
 */

const router = express.Router();

/**
 * @route   GET /v1/audit/logs
 * @desc    Get system audit logs with filtering and pagination
 * @access  Private (SUPER_ADMIN only)
 */
router.get(
  "/logs",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
  auditController.getAuditLogsController
);

export default router;
