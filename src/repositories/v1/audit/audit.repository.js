import prisma from "../../../utils/prisma.js";

/**
 * Audit Repository - The "History Search Engine"
 * Handles administrative database operations for tracking system actions.
 */

/**
 * Save a new audit log record.
 * @param {object} data - The audit event details.
 * @returns {Promise<object>} The created log entry.
 */
export async function create(data) {
  return await prisma.auditLog.create({
    data,
  });
}

/**
 * Find audit logs with advanced filtering and pagination.
 * @param {object} filters - action, entityType, actorUserId, from (Date), to (Date).
 * @param {number} limit - Number of records to return.
 * @param {number} offset - Number of records to skip.
 * @returns {Promise<object>} { total, logs }
 */
export async function findAndCount(filters, limit = 50, offset = 0) {
  // 1. Build the dynamic 'where' object for Prisma
  const where = {};

  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;
  if (filters.entityId) where.entityId = filters.entityId;

  // Handle Date range filtering
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }

  // 2. Execute count and findMany in a single transaction for consistency
  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: {
        actor: true, // Fetch actor details (name, email) for human readability
      },
      orderBy: { createdAt: "desc" }, // Most recent first
      take: Number(limit),
      skip: Number(offset),
    }),
  ]);

  return { total, logs };
}
