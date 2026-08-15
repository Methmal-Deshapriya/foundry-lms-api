import * as auditService from "../../../services/v1/audit/audit.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Audit Controller - The "History Viewer"
 * Handles administrative requests for system action logs.
 */

/**
 * Controller: Get audit logs with filtering and pagination.
 * GET /v1/audit/logs
 */
export async function getAuditLogsController(req, res, next) {
  try {
    const result = await auditService.getAuditLogsService(req.query);

    // 4. Return success response with pagination metadata
    return ApiResponse.send(res, result, "Audit logs retrieved successfully");
  } catch (error) {
    next(error);
  }
}
