import express from "express";
import * as categoryController from "../../../controllers/v1/catalog/category.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), categoryController.getCategoriesAdmin);
router.get("/:id", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), categoryController.getCategoryAdmin);
router.post("/", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), categoryController.createCategory);
router.patch("/:id", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), categoryController.updateCategory);
router.patch("/:id/publish", requirePermission(PERMISSIONS.CATALOG_PUBLISH), categoryController.publishCategory);
router.patch("/:id/unpublish", requirePermission(PERMISSIONS.CATALOG_PUBLISH), categoryController.unpublishCategory);
router.patch("/:id/archive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), categoryController.archiveCategory);
router.patch("/:id/unarchive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), categoryController.unarchiveCategory);
router.delete(
  "/:id",
  requirePermission(PERMISSIONS.CATALOG_DELETE_PERMANENTLY),
  categoryController.deleteCategoryPermanently,
);

export default router;
