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
    // 1. Extract filters and pagination from query parameters
    const { 
      action, 
      resourceType, // We'll map this to entityType
      actorUserId, 
      entityId,
      from, 
      to, 
      limit = 50, 
      offset = 0 
    } = req.query;

    // 2. Prepare the filters object for the service
    const filters = {
      action,
      entityType: resourceType,
      actorUserId,
      entityId,
      from,
      to,
    };

    // 3. Call the service to fetch the history
    const result = await auditService.getAuditLogsService(
      filters, 
      Number(limit), 
      Number(offset)
    );

    // 4. Return success response with pagination metadata
    return ApiResponse.send(res, result, "Audit logs retrieved successfully");
  } catch (error) {
    next(error);
  }
}
