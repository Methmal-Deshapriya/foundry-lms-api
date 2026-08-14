import express from "express";
import * as certificateController from "../../../controllers/v1/enrollments/certificate.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";
import { certificateVerificationLimiter } from "../../../middlewares/rateLimiters.js";

const router = express.Router();

/**
 * Public Route
 */
router.get(
  "/verify/:code",
  certificateVerificationLimiter,
  certificateController.verifyCertificate,
);

/**
 * Protected Routes
 */
router.use(authenticate);

router.get("/my", certificateController.getMyCertificates);

router.get(
  "/admin",
  requirePermission(PERMISSIONS.CERTIFICATES_MANAGE),
  certificateController.getAllCertificatesAdmin
);

router.get("/:id", certificateController.getCertificateDetails);

router.patch(
  "/:id/revoke",
  requirePermission(PERMISSIONS.CERTIFICATES_MANAGE),
  certificateController.revokeCertificate
);

export default router;
