import * as paymentService from "../../../services/v1/payments/payment.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Payment Ledger Controller — super admins only.
 */

const handle = (fn, message) => async (req, res, next) => {
  try {
    return ApiResponse.send(res, await fn(req), message);
  } catch (error) {
    next(error);
  }
};

export const getLedger = handle((req) => paymentService.getLedgerService(req.query), "Payments fetched successfully");
export const getOutstanding = handle(() => paymentService.getOutstandingService(), "Outstanding balances fetched successfully");
export const getMonthlySummary = handle((req) => paymentService.getMonthlySummaryService(req.query), "Monthly summary fetched successfully");
export const getPayment = handle((req) => paymentService.getPaymentService(req.params.id), "Payment fetched successfully");
export const refundPayment = handle((req) => paymentService.refundPaymentService(req.params.id, req.body, req.user.id), "Refund recorded");
export const reversePayment = handle((req) => paymentService.reversePaymentService(req.params.id, req.body, req.user.id), "Payment reversed");
export const updatePaymentDetails = handle(
  (req) => paymentService.updatePaymentDetailsService(req.params.id, req.body, req.user.id),
  "Payment details updated",
);
