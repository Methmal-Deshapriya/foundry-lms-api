import * as auditRepo from "../../../repositories/v1/audit/audit.repository.js";
import * as auditModel from "../../../models/v1/audit/audit.model.js";
import Logger from "../../../utils/logger.js";

/**
 * Audit Service - The "Accountability Engine"
 * Orchestrates background logging and administrative history retrieval.
 */

/**
 * Service: Record a system action in the background (Fire and Forget).
 * This function does NOT return a promise to be awaited by the caller.
 * It handles its own errors to ensure the main application flow is never blocked.
 * 
 * @param {object} payload - actorUserId, action, entityType, entityId, description, metadata.
 */
export function recordActionService(payload) {
  // Fire and Forget: Trigger the repository write and handle errors internally
  auditRepo.create(payload).catch((error) => {
    // We log the error to the server console but never throw it back to the user
    Logger.error(`[AUDIT_FAILED]: Failed to record background audit log for action: ${payload.action}`, error);
  });
  
  // Implicitly returns undefined immediately
}

/**
 * Service: Get audit logs with filtering and pagination for Super Admins.
 * @param {object} filters - action, entityType, actorUserId, from, to.
 * @param {number} limit - Items per page.
 * @param {number} offset - Items to skip.
 * @returns {Promise<object>} { logs, pagination }
 */
export async function getAuditLogsService(filters, limit = 50, offset = 0) {
  // 1. Fetch data and total count from repository
  const { total, logs } = await auditRepo.findAndCount(filters, limit, offset);

  // 2. Map raw records to sanitized model shape
  const sanitizedLogs = auditModel.toAuditLogListResponse(logs);

  // 3. Construct professional pagination metadata
  const pagination = {
    total,
    limit: Number(limit),
    offset: Number(offset),
    hasMore: Number(offset) + sanitizedLogs.length < total,
  };

  return {
    logs: sanitizedLogs,
    pagination,
  };
}
