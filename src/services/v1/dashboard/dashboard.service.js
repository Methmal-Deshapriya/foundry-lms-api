import * as dashboardRepo from "../../../repositories/v1/dashboard/dashboard.repository.js";
import * as dashboardModel from "../../../models/v1/dashboard/dashboard.model.js";
import { adminDashboardQuerySchema } from "../../../constants/v1/dashboard/dashboard.schema.js";
import { ValidationError } from "../../../utils/Errors.js";

/**
 * Dashboard Service - The "Brain"
 * Orchestrates the two role-specific dashboard summaries.
 */

export async function getStudentDashboardService(userId) {
  const summary = await dashboardRepo.getStudentSummary(userId);
  return dashboardModel.toStudentDashboardResponse(summary);
}

export async function getAdminDashboardService(query = {}) {
  const validation = adminDashboardQuerySchema.safeParse(query);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue.message, issue.path.join(".") || null);
  }
  const summary = await dashboardRepo.getAdminSummary(validation.data);
  return dashboardModel.toAdminDashboardResponse(summary);
}
