import express from "express";
import * as controller from "../../../controllers/v1/partners/partner.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import { requirePermission } from "../../../middlewares/requirePermission.js";
import { PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";

// Partner earnings — protected exactly like the payment ledger: super
// admins only (decided 2026-10-01; no extra lock).
const router = express.Router();
router.use(authenticate);

const view = requirePermission(PERMISSIONS.PAYMENTS_VIEW);
const manage = requirePermission(PERMISSIONS.PAYMENTS_MANAGE);

router.get("/overview", view, controller.overview);
router.get("/by-intake", view, controller.byIntake);
router.get("/shares", view, controller.shares);
router.post("/shares", manage, controller.createShareSet);
router.get("/expenses", view, controller.listExpenses);
router.get("/expenses/:id", view, controller.getExpense);
router.post("/expenses", manage, controller.createExpense);
router.post("/expenses/:id/reverse", manage, controller.reverseExpense);
router.get("/payouts", view, controller.listPayouts);
router.post("/payouts", manage, controller.createPayout);
router.post("/payouts/:id/reverse", manage, controller.reversePayout);

export default router;
