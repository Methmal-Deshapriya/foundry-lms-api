import * as auditRepo from "../../../repositories/v1/audit/audit.repository.js";
import * as auditModel from "../../../models/v1/audit/audit.model.js";
import Logger from "../../../utils/logger.js";
import { auditLogQuerySchema } from "../../../constants/v1/audit/audit.schema.js";
import { ValidationError } from "../../../utils/Errors.js";

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
export async function getAuditLogsService(query = {}) {
  const validation = auditLogQuerySchema.safeParse(query);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue.message, issue.path.join(".") || null);
  }
  const { resourceType, limit, cursor, ...filters } = validation.data;
  const { total, logs } = await auditRepo.findAndCount(
    { ...filters, entityType: resourceType },
    limit,
    cursor,
  );
  const hasMore = logs.length > limit;
  const pageLogs = logs.slice(0, limit);
  const sanitizedLogs = auditModel.toAuditLogListResponse(pageLogs);
  const pagination = {
    total,
    limit,
    hasMore,
    nextCursor: hasMore ? pageLogs.at(-1)?.id ?? null : null,
  };

  return {
    logs: sanitizedLogs,
    pagination,
  };
}
