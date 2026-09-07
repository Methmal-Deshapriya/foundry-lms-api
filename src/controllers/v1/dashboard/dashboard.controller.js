import * as dashboardService from "../../../services/v1/dashboard/dashboard.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Dashboard Controller - The "Front Desk"
 */

export async function getStudentDashboardController(req, res, next) {
  try {
    const data = await dashboardService.getStudentDashboardService(req.user.id);
    return ApiResponse.send(res, data, "Student dashboard summary fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getAdminDashboardController(req, res, next) {
  try {
    const data = await dashboardService.getAdminDashboardService();
    return ApiResponse.send(res, data, "Admin dashboard summary fetched successfully");
  } catch (error) {
    next(error);
  }
}
