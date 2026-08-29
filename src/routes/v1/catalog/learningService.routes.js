import express from "express";
import * as controller from "../../../controllers/v1/catalog/learningService.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router();
router.use(authenticate);

router.get("/", requirePermission(PERMISSIONS.LEARNING_SERVICES_VIEW), controller.list);
router.get("/summary", requirePermission(PERMISSIONS.LEARNING_SERVICES_VIEW), controller.list);
router.get("/:id/deletion-impact", requirePermission(PERMISSIONS.LEARNING_SERVICES_DELETE_PERMANENTLY), controller.deletionImpact);
router.get("/:id", requirePermission(PERMISSIONS.LEARNING_SERVICES_VIEW), controller.get);
router.post("/", requirePermission(PERMISSIONS.LEARNING_SERVICES_MANAGE), controller.create);
router.patch("/:id", requirePermission(PERMISSIONS.LEARNING_SERVICES_MANAGE), controller.update);
router.patch("/:id/activate", requirePermission(PERMISSIONS.LEARNING_SERVICES_PUBLISH), controller.activate);
router.patch("/:id/deactivate", requirePermission(PERMISSIONS.LEARNING_SERVICES_PUBLISH), controller.deactivate);
router.patch("/:id/archive", requirePermission(PERMISSIONS.LEARNING_SERVICES_PUBLISH), controller.archive);
router.patch("/:id/unarchive", requirePermission(PERMISSIONS.LEARNING_SERVICES_PUBLISH), controller.restore);
router.delete("/:id", requirePermission(PERMISSIONS.LEARNING_SERVICES_DELETE_PERMANENTLY), controller.remove);

export default router;
