import express from "express";
import * as controller from "../../../controllers/v1/catalog/course.controller.js";
import * as intakeController from "../../../controllers/v1/catalog/intake.controller.js";
import * as enrollmentRequestController from "../../../controllers/v1/enrollments/enrollmentRequest.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);

// Intakes nested under their course — matches the /courses/:courseId/enrollments
// nesting convention already used elsewhere in this codebase.
router.get("/:courseId/intakes", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), intakeController.list);
router.get("/:courseId/intakes/defaults", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), intakeController.defaults);
router.post("/:courseId/intakes", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), intakeController.create);

// A visitor clicking "Enroll" on a PAID course — see the rename plan §8a.
router.post("/:courseId/enrollment-requests", requirePermission(PERMISSIONS.COURSES_SELF_ENROLL), enrollmentRequestController.create);

router.get("/", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), controller.list);
router.get("/:id/deletion-impact", requirePermission(PERMISSIONS.CATALOG_DELETE_PERMANENTLY), controller.deletionImpact);
router.get("/:id", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), controller.get);
router.post("/", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), controller.create);
router.patch("/:id", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), controller.update);
router.patch("/:id/archive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), controller.archive);
router.patch("/:id/unarchive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), controller.restore);
router.delete("/:id", requirePermission(PERMISSIONS.CATALOG_DELETE_PERMANENTLY), controller.remove);
export default router;
