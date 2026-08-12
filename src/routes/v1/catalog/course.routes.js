import express from "express";
import * as courseController from "../../../controllers/v1/catalog/course.controller.js";
import * as enrollmentController from "../../../controllers/v1/enrollments/enrollment.controller.js";
import curriculumRoutes from "../courses/courseCurriculum.routes.js";
import courseBatchRoutes from "../batches/courseBatch.routes.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);

router.use("/:courseId/curriculum", curriculumRoutes);
router.use("/:courseId/batches", courseBatchRoutes);
router.post(
  "/:courseId/enroll",
  requirePermission(PERMISSIONS.COURSES_SELF_ENROLL),
  enrollmentController.selfEnrollFreeCourseController
);
router.get("/", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), courseController.getCoursesAdmin);
router.get(
  "/:id/deletion-impact",
  requirePermission(PERMISSIONS.CATALOG_DELETE_PERMANENTLY),
  courseController.getCourseDeletionImpact,
);
router.get("/:id", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), courseController.getCourseAdmin);
router.post("/", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), courseController.createCourse);
router.patch("/:id", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), courseController.updateCourse);
router.patch(
  "/:id/enrollment-status",
  requirePermission(PERMISSIONS.CATALOG_PUBLISH),
  courseController.setCourseEnrollmentStatus,
);
router.patch("/:id/publish", requirePermission(PERMISSIONS.CATALOG_PUBLISH), courseController.publishCourse);
router.patch("/:id/unpublish", requirePermission(PERMISSIONS.CATALOG_PUBLISH), courseController.unpublishCourse);
router.patch("/:id/archive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), courseController.archiveCourse);
router.patch("/:id/unarchive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), courseController.unarchiveCourse);
router.delete(
  "/:id",
  requirePermission(PERMISSIONS.CATALOG_DELETE_PERMANENTLY),
  courseController.deleteCoursePermanently,
);

export default router;
