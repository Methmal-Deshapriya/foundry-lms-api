import express from "express";
import * as bootcampController from "../../../controllers/v1/bootcamps/bootcamp.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

/**
 * Bootcamp Routes - The "Security Map"
 * Maps HTTP addresses to course marketplace and management actions.
 */

const router = express.Router();

/* --- Public Routes (Marketplace) --- */

/**
 * @route   GET /v1/bootcamps
 * @desc    Get all published bootcamps
 * @access  Public
 */
router.get("/", bootcampController.getAllPublicBootcampsController);

/* --- Admin Routes (Management) --- */

/**
 * IMPORTANT: The /admin route must be defined BEFORE the /:slug route.
 * Otherwise, Express will treat "admin" as a slug value.
 * 
 * @route   GET /v1/bootcamps/admin
 * @desc    Get all bootcamps (full data)
 * @access  Private (ADMIN, SUPER_ADMIN)
 */
router.get(
  "/admin",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  bootcampController.getAllAdminBootcampsController
);

/**
 * @route   POST /v1/bootcamps
 * @desc    Create a new bootcamp
 * @access  Private (ADMIN, SUPER_ADMIN)
 */
router.post(
  "/",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  bootcampController.createBootcampController
);

/**
 * @route   PATCH /v1/bootcamps/:id
 * @desc    Update an existing bootcamp
 * @access  Private (ADMIN, SUPER_ADMIN)
 */
router.patch(
  "/:id",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  bootcampController.updateBootcampController
);

/**
 * @route   DELETE /v1/bootcamps/:id
 * @desc    Delete a bootcamp
 * @access  Private (ADMIN, SUPER_ADMIN)
 */
router.delete(
  "/:id",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  bootcampController.deleteBootcampController
);

/**
 * @route   PATCH /v1/bootcamps/:id/publish
 * @desc    Make a bootcamp visible to the public
 * @access  Private (ADMIN, SUPER_ADMIN)
 */
router.patch(
  "/:id/publish",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  bootcampController.publishBootcampController
);

/**
 * @route   PATCH /v1/bootcamps/:id/unpublish
 * @desc    Hide a bootcamp from the public
 * @access  Private (ADMIN, SUPER_ADMIN)
 */
router.patch(
  "/:id/unpublish",
  authenticate,
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  bootcampController.unpublishBootcampController
);

/* --- Public Dynamic Routes --- */

/**
 * @route   GET /v1/bootcamps/:slug
 * @desc    Get single bootcamp by slug
 * @access  Public
 */
router.get("/:slug", bootcampController.getBootcampBySlugController);

export default router;
