import { toAdminUserResponse } from "../users/user.model.js";

/**
 * Audit Model - The "History Mask"
 * Defines the shape of audit logs for the Super Admin dashboard.
 */

/**
 * Transform a raw audit log record into a readable dashboard item.
 * Includes details about the actor who performed the action.
 * 
 * @param {object} log - The raw audit log record with actor included.
 * @returns {object} The sanitized audit log.
 */
export function toAuditLogResponse(log) {
  if (!log) return null;

  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    description: log.description,
    metadata: log.metadata,
    createdAt: log.createdAt,
    // Include actor details using our existing user model
    actor: log.actor ? toAdminUserResponse(log.actor) : { firstName: "System", lastName: "" },
  };
}

/**
 * Transform an array of audit logs.
 */
export function toAuditLogListResponse(logs) {
  if (!logs || !Array.isArray(logs)) return [];
  return logs.map((log) => toAuditLogResponse(log));
}
