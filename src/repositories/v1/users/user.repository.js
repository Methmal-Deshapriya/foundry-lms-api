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

/**
 * Search students who are not already enrolled in a given bootcamp.
 * @param {string} bootcampId - UUID of the bootcamp.
 * @param {string} query - Partial email search text.
 * @param {number} limit - Max number of students to return.
 * @returns {Promise<Array>} List of eligible student users.
 */
export async function searchEligibleStudentsForBootcamp(
  bootcampId,
  query = "",
  limit = 5
) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";

  return await prisma.user.findMany({
    where: {
      role: "STUDENT",
      email: normalizedQuery
        ? {
            contains: normalizedQuery,
            mode: "insensitive",
          }
        : undefined,
      enrollments: {
        none: {
          bootcampId,
        },
      },
    },
    orderBy: {
      email: "asc",
    },
    take: Number(limit),
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
  try {
    return await prisma.user.update({
      where: { id },
      data: { role },
    });
  } catch (error) {
    // Translates Prisma errors (like user not found) into CustomErrors
    throw handlePrismaError(error);
  }
}
