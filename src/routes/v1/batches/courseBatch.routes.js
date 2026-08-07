import express from "express";
import * as batchController from "../../../controllers/v1/batches/batch.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

const router = express.Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  requirePermission(PERMISSIONS.BATCHES_MANAGE),
  batchController.listCourseBatches,
);
router.post(
  "/",
  requirePermission(PERMISSIONS.BATCHES_MANAGE),
  batchController.createBatch,
);

export default router;

