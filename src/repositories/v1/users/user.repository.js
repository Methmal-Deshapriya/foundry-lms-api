import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * User Repository - The "Librarian"
 * Handles administrative database operations for the Users module.
 */

/**
 * Fetch users from the database with optional role filtering and pagination.
 * @param {object} filters - Supported filters for the user list.
 * @param {number} limit - Number of records to return.
 * @param {number} offset - Number of records to skip.
 * @returns {Promise<object>} { total, users }
 */
export async function findAndCountUsers(filters = {}, limit = 10, offset = 0) {
  const where = {};

  if (filters.role) {
    where.role = filters.role;
  }

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: {
        createdAt: "desc", // Newest users first
      },
      take: Number(limit),
      skip: Number(offset),
    }),
  ]);

  return { total, users };
}

export async function findVerifiedStudentsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return prisma.user.findMany({
    where: { id: { in: ids }, role: "STUDENT", emailVerified: true },
  });
}

/**
 * Find a specific user by their unique ID.
 * @param {string} id - The UUID of the user.
 * @returns {Promise<object|null>} The user object or null.
 */
export async function findUserById(id) {
  try {
    return await prisma.user.findUnique({
      where: { id },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Update a user's system role (STUDENT, ADMIN, SUPER_ADMIN).
 * @param {string} id - The UUID of the user to update.
 * @param {string} role - The new role to assign.
 * @returns {Promise<object>} The updated user object.
 */
export async function updateUserRole(id, role) {
  return await updateUser(id, {
    role,
    securityVersion: { increment: 1 },
  });
}

/**
 * Update a user record.
 * @param {string} id - The UUID of the user.
 * @param {object} data - The fields to update.
 * @returns {Promise<object>} The updated user.
 */
export async function updateUser(id, data) {
  try {
    return await prisma.user.update({
      where: { id },
      data,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
