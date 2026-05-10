import express from "express";
import * as userController from "../../../controllers/v1/users/user.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

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
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  userController.getAllUsersController,
);

/**
 * @route   PATCH /v1/users/:id/promote
 * @desc    Promote a user to ADMIN
 * @access  Private (SUPER_ADMIN only)
 */
router.patch(
  "/:id/promote",
  authenticate,
  requireRole([ROLES.SUPER_ADMIN]),
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
  requireRole([ROLES.SUPER_ADMIN]),
  userController.demoteUserController,
);

export default router;
