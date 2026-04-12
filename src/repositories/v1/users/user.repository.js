import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * User Repository - The "Librarian"
 * Handles administrative database operations for the Users module.
 */

/**
 * Fetch all users from the database.
 * @returns {Promise<Array>} Array of all user objects.
 */
export async function findAllUsers() {
  return await prisma.user.findMany({
    orderBy: {
      createdAt: "desc", // Newest users first
    },
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
