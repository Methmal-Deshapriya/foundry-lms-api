import express from "express";
import * as controller from "../../../controllers/v1/payments/payment.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

// The payment ledger — super admins only (PAYMENTS_VIEW / PAYMENTS_MANAGE
// are granted to SUPER_ADMIN alone in permissions.constants.js).
const router = express.Router();
router.use(authenticate);

const view = requirePermission(PERMISSIONS.PAYMENTS_VIEW);
const manage = requirePermission(PERMISSIONS.PAYMENTS_MANAGE);

router.get("/", view, controller.getLedger);
router.get("/outstanding", view, controller.getOutstanding);
router.get("/summary/monthly", view, controller.getMonthlySummary);
router.get("/:id", view, controller.getPayment);
router.post("/:id/refund", manage, controller.refundPayment);
router.post("/:id/reverse", manage, controller.reversePayment);
router.patch("/:id/details", manage, controller.updatePaymentDetails);

export default router;
