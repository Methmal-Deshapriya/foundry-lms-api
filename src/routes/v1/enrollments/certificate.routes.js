import express from "express";
import * as certificateController from "../../../controllers/v1/enrollments/certificate.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requireRole } from "../../../middlewares/requireRole.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

const router = express.Router();

/**
 * Public Route
 */
router.get("/verify/:code", certificateController.verifyCertificate);

/**
 * Protected Routes
 */
router.use(authenticate);

router.get("/my", certificateController.getMyCertificates);

router.get(
  "/admin",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  certificateController.getAllCertificatesAdmin
);

router.get("/:id", certificateController.getCertificateDetails);

router.patch(
  "/:id/revoke",
  requireRole([ROLES.ADMIN, ROLES.SUPER_ADMIN]),
  certificateController.revokeCertificate
);

export default router;
