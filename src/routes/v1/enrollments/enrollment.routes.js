import express from "express";
import * as enrollmentController from "../../../controllers/v1/enrollments/enrollment.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

/**
 * Enrollment Routes - The "Access Map"
 * Maps HTTP addresses to course enrollment actions.
 */

const router = express.Router();

// Apply authentication to ALL enrollment routes
router.use(authenticate);

/**
 * @route   GET /v1/enrollments/my
 * @desc    Get current student's enrolled bootcamps
 * @access  Private (STUDENT, ADMIN, SUPER_ADMIN)
 */
router.get("/my", enrollmentController.getMyEnrollmentsController);

/**
 * @route   POST /v1/enrollments
 * @desc    Manually enroll a student into a bootcamp
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.post(
  "/",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  enrollmentController.enrollStudentController
);

/**
 * @route   GET /v1/enrollments/bootcamp/:bootcampId
 * @desc    Get all students enrolled in a specific bootcamp
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.get(
  "/bootcamp/:bootcampId",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  enrollmentController.getBootcampStudentsController
);

export default router;
