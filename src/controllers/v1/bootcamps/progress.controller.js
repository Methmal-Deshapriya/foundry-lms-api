import * as progressService from "../../../services/v1/bootcamps/progress.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

/**
 * Progress Controller
 */

export async function markComplete(req, res, next) {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user.id;
    const result = await progressService.markSessionCompleteService(sessionId, userId);
    return ApiResponse.send(res, result, "Session marked as complete");
  } catch (error) {
    next(error);
  }
}

export async function unmarkComplete(req, res, next) {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user.id;
    await progressService.unmarkSessionCompleteService(sessionId, userId);
    return ApiResponse.send(res, null, "Session unmarked as complete");
  } catch (error) {
    next(error);
  }
}

export async function getProgress(req, res, next) {
  try {
    const { enrollmentId } = req.params;
    const userId = req.user.id;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role);

    const progress = await progressService.getProgressService(enrollmentId, userId, isAdmin);
    return ApiResponse.send(res, progress, "Progress fetched successfully");
  } catch (error) {
    next(error);
  }
}
