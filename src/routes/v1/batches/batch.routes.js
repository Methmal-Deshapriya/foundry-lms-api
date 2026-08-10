import express from "express";
import * as batchController from "../../../controllers/v1/batches/batch.controller.js";
import * as enrollmentController from "../../../controllers/v1/enrollments/enrollment.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);

router.get(
  "/:id",
  requirePermission(PERMISSIONS.BATCHES_MANAGE),
  batchController.getBatch,
);
router.patch(
  "/:id",
  requirePermission(PERMISSIONS.BATCHES_MANAGE),
  batchController.updateBatch,
);
router.get(
  "/:id/eligible-students",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.getEligibleStudentsForBatchController,
);
router.get(
  "/:id/enrollments",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.getBatchEnrollmentsController,
);
router.post(
  "/:id/enrollments",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.enrollStudentInBatchController,
);
router.post(
  "/:id/enrollments/bulk",
  requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE),
  enrollmentController.bulkEnrollStudentsInBatchController,
);
router.patch(
  "/:id/status",
  requirePermission(PERMISSIONS.BATCHES_MANAGE),
  batchController.updateBatchStatus,
);
router.get(
  "/:id/sessions",
  requirePermission(PERMISSIONS.BATCHES_MANAGE),
  batchController.getBatchSessions,
);
router.patch(
  "/:id/sessions/:courseSessionId/delivery",
  requirePermission(PERMISSIONS.BATCH_SESSIONS_RELEASE),
  batchController.updateBatchSessionDelivery,
);

export default router;
