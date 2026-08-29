import express from "express";
import * as controller from "../../../controllers/v1/catalog/courseGroup.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);
router.get("/", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), controller.list);
router.get("/:id/deletion-impact", requirePermission(PERMISSIONS.CATALOG_DELETE_PERMANENTLY), controller.deletionImpact);
router.get("/:id", requirePermission(PERMISSIONS.CATALOG_VIEW_ADMIN), controller.get);
router.post("/", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), controller.create);
router.patch("/:id", requirePermission(PERMISSIONS.CATALOG_EDIT_DRAFTS), controller.update);
router.patch("/:id/archive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), controller.archive);
router.patch("/:id/unarchive", requirePermission(PERMISSIONS.CATALOG_PUBLISH), controller.restore);
router.delete("/:id", requirePermission(PERMISSIONS.CATALOG_DELETE_PERMANENTLY), controller.remove);
export default router;
