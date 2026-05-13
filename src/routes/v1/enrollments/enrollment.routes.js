import express from "express";
import * as enrollmentController from "../../../controllers/v1/enrollments/enrollment.controller.js";
import * as progressController from "../../../controllers/v1/bootcamps/progress.controller.js";
import * as certificateController from "../../../controllers/v1/enrollments/certificate.controller.js";
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
 * @route   GET /v1/enrollments/:enrollmentId/progress
 * @desc    Get derived progress for an enrollment
 * @access  Private (Owner or Admin)
 */
router.get("/:enrollmentId/progress", progressController.getProgress);

/**
 * @route   POST /v1/enrollments/:enrollmentId/certificate
 * @desc    Issue a certificate for a completed enrollment
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.post(
  "/:enrollmentId/certificate",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  certificateController.issueCertificate
);

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
 * @route   PATCH /v1/enrollments/:id
 * @desc    Update enrollment status or payment (Admin)
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.patch(
  "/:id",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  enrollmentController.updateEnrollmentController
);

/**
 * @route   GET /v1/enrollments/bootcamp/:bootcampId/eligible-students
 * @desc    Get students eligible for manual enrollment in a specific bootcamp
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.get(
  "/bootcamp/:bootcampId/eligible-students",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  enrollmentController.getEligibleStudentsForBootcampController
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
