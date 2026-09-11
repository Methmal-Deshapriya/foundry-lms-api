import express from "express";
import * as enrollmentController from "../../../controllers/v1/enrollments/enrollment.controller.js";
import * as certificateController from "../../../controllers/v1/enrollments/certificate.controller.js";
import * as classroomController from "../../../controllers/v1/learning/classroom.controller.js";
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

router.get("/:enrollmentId/classroom", classroomController.getClassroom);
router.get("/:enrollmentId/progress", classroomController.getProgress);
router.get(
  "/:enrollmentId/sessions/:courseSessionId",
  classroomController.getSession,
);
router.post(
  "/:enrollmentId/sessions/:courseSessionId/complete",
  classroomController.completeSession,
);
router.delete(
  "/:enrollmentId/sessions/:courseSessionId/complete",
  classroomController.uncompleteSession,
);

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
 * @route   POST /v1/enrollments/:id/complete-payment
 * @desc    Record the remaining half-payment for a PARTIAL enrollment
 * @access  Private (ADMIN, SUPER_ADMIN only)
 */
router.post(
  "/:id/complete-payment",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.completePaymentController
);

export default router;
