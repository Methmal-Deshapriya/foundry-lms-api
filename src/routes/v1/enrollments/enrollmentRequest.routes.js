import express from "express";
import * as controller from "../../../controllers/v1/enrollments/enrollmentRequest.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

// Flat routes for a single request, addressed by its own id. Creation lives
// on course.routes.js (POST /courses/:courseId/enrollment-requests) and the
// per-intake list lives on intake.routes.js (GET
// /intakes/:intakeId/enrollment-requests) — see the rename plan §5.
const router = express.Router();
router.use(authenticate);
router.get("/:id", requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE), controller.get);
router.patch("/:id/status", requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE), controller.updateStatus);
router.post("/:id/enroll", requirePermission(PERMISSIONS.ENROLLMENTS_MANAGE), controller.enroll);
export default router;
