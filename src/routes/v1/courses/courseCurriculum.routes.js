import express from "express";
import * as curriculumController from "../../../controllers/v1/courses/courseCurriculum.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.SESSIONS_VIEW_LIBRARY),
  curriculumController.getCurriculum,
);
router.post(
  "/",
  requirePermission(PERMISSIONS.COURSE_CURRICULUM_MANAGE),
  curriculumController.attachSession,
);
router.patch(
  "/reorder",
  requirePermission(PERMISSIONS.COURSE_CURRICULUM_MANAGE),
  curriculumController.reorderCurriculum,
);
router.delete(
  "/:courseSessionId",
  requirePermission(PERMISSIONS.COURSE_CURRICULUM_MANAGE),
  curriculumController.removeSession,
);

export default router;

