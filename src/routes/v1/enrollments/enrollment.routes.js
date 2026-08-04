import express from "express";
import * as enrollmentController from "../../../controllers/v1/enrollments/enrollment.controller.js";
import * as progressController from "../../../controllers/v1/courses/progress.controller.js";
import * as certificateController from "../../../controllers/v1/enrollments/certificate.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

/**
 * Enrollment Routes - The "Access Map"
 * Maps HTTP addresses to course enrollment actions.
 */

const router = express.Router();

// Apply authentication to ALL enrollment routes
router.use(authenticate);

/**
 * @route   GET /v1/enrollments/my
 * @desc    Get current student's enrolled courses
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
  requirePermission(PERMISSIONS.CERTIFICATES_MANAGE),
  certificateController.issueCertificate
);

/**
 * @route   POST /v1/enrollments
 * @desc    Manually enroll a student into a course
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.post(
  "/",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.enrollStudentController
);

/**
 * @route   PATCH /v1/enrollments/:id
 * @desc    Update enrollment status or payment (Admin)
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.patch(
  "/:id",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.updateEnrollmentController
);

/**
 * @route   GET /v1/enrollments/course/:courseId/eligible-students
 * @desc    Get students eligible for manual enrollment in a specific course
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.get(
  "/course/:courseId/eligible-students",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.getEligibleStudentsForCourseController
);

/**
 * @route   GET /v1/enrollments/course/:courseId
 * @desc    Get all students enrolled in a specific course
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.get(
  "/course/:courseId",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.getCourseStudentsController
);

export default router;
