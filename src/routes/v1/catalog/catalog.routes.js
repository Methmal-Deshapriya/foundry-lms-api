import express from "express";
import * as catalogController from "../../../controllers/v1/catalog/catalog.controller.js";
import { listPublic as listPublicLearningServices } from "../../../controllers/v1/catalog/learningService.controller.js";

const router = express.Router();

router.get("/services", listPublicLearningServices);
router.get("/:serviceSlug/categories", catalogController.getPublicCategories);
router.get("/:serviceSlug/categories/:categorySlug", catalogController.getPublicCategory);
router.get(
  "/:serviceSlug/categories/:categorySlug/courses/:courseSlug",
  catalogController.getPublicCourse,
);

export default router;
