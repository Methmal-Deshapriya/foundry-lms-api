import * as service from "../../../services/v1/partners/partner.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Partner earnings controller — super admins only.
 */

const handle = (fn, message, status = 200) => async (req, res, next) => {
  try {
    return ApiResponse.send(res, await fn(req), message, status);
  } catch (error) {
    next(error);
  }
};

export const overview = handle((req) => service.getOverviewService(req.query), "Partner earnings fetched");
export const byIntake = handle((req) => service.getByIntakeService(req.query), "Earnings by intake fetched");
export const shares = handle(() => service.getSharesService(), "Shares fetched");
export const createShareSet = handle((req) => service.createShareSetService(req.body, req.user.id), "New split saved", 201);
export const listExpenses = handle((req) => service.listExpensesService(req.query), "Expenses fetched");
export const getExpense = handle((req) => service.getExpenseService(req.params.id), "Expense fetched");
export const createExpense = handle((req) => service.createExpenseService(req.body, req.user.id), "Expense recorded", 201);
export const reverseExpense = handle((req) => service.reverseExpenseService(req.params.id, req.body, req.user.id), "Expense reversed");
export const listPayouts = handle((req) => service.listPayoutsService(req.query), "Payouts fetched");
export const createPayout = handle((req) => service.createPayoutService(req.body, req.user.id), "Payout recorded", 201);
export const reversePayout = handle((req) => service.reversePayoutService(req.params.id, req.body, req.user.id), "Payout reversed");
