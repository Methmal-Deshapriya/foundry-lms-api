import express from "express";
import * as userController from "../../../controllers/v1/users/user.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

/**
 * User Routes - The "Security Map"
 * Maps HTTP addresses to administrative user management actions.
 */

const router = express.Router();

/**
 * @route   PATCH /v1/users/profile
 * @desc    Update current user profile
 * @access  Private
 */
router.patch(
  "/profile",
  authenticate,
  userController.updateProfileController,
);

/**
 * @route   GET /v1/users
 * @desc    Get all registered users
 * @access  Private (ADMIN or SUPER_ADMIN)
 */
router.get(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.USERS_VIEW),
  userController.getAllUsersController,
);

/**
 * @route   GET /v1/users/:id
 * @desc    Get one user's full profile and activity summary
 * @access  Private (ADMIN or SUPER_ADMIN)
 */
router.get(
  "/:id",
  authenticate,
  requirePermission(PERMISSIONS.USERS_VIEW),
  userController.getOneUserController,
);

/**
 * @route   PATCH /v1/users/:id/promote
 * @desc    Promote a user to ADMIN
 * @access  Private (SUPER_ADMIN only)
 */
router.patch(
  "/:id/promote",
  authenticate,
  requirePermission(PERMISSIONS.USERS_MANAGE_ROLES),
  userController.promoteUserController,
);

/**
 * @route   PATCH /v1/users/:id/demote
 * @desc    Demote an ADMIN to STUDENT
 * @access  Private (SUPER_ADMIN only)
 */
router.patch(
  "/:id/demote",
  authenticate,
  requirePermission(PERMISSIONS.USERS_MANAGE_ROLES),
  userController.demoteUserController,
);

export default router;
