import * as dashboardRepo from "../../../repositories/v1/dashboard/dashboard.repository.js";
import * as dashboardModel from "../../../models/v1/dashboard/dashboard.model.js";

/**
 * Dashboard Service - The "Brain"
 * Orchestrates the two role-specific dashboard summaries.
 */

export async function getStudentDashboardService(userId) {
  const summary = await dashboardRepo.getStudentSummary(userId);
  return dashboardModel.toStudentDashboardResponse(summary);
}

export async function getAdminDashboardService() {
  const summary = await dashboardRepo.getAdminSummary();
  return dashboardModel.toAdminDashboardResponse(summary);
}
