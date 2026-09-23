import express from "express";
import * as catalogController from "../../../controllers/v1/catalog/catalog.controller.js";
import { listPublic as listPublicLearningServices } from "../../../controllers/v1/catalog/learningService.controller.js";

const router = express.Router();

router.get("/services", listPublicLearningServices);
router.get("/explore", catalogController.getPublicExplore);
router.get("/:serviceSlug/courses", catalogController.getPublicCourses);
router.get("/:serviceSlug/courses/:courseSlug", catalogController.getPublicCourse);

export default router;
