import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Enrollment Repository - The "Bridge Librarian"
 * Handles all database operations linking users to bootcamps.
 */

/**
 * Create a new enrollment record.
 * @param {string} userId - UUID of the student.
 * @param {string} bootcampId - UUID of the bootcamp.
 * @returns {Promise<object>} The new enrollment record.
 */
export async function create(userId, bootcampId) {
  try {
    return await prisma.enrollment.create({
      data: {
        userId,
        bootcampId,
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Find a specific enrollment by user and bootcamp.
 * Used to prevent duplicate enrollments.
 * @param {string} userId - UUID of the student.
 * @param {string} bootcampId - UUID of the bootcamp.
 * @returns {Promise<object|null>} The enrollment record or null.
 */
export async function findExisting(userId, bootcampId) {
  return await prisma.enrollment.findUnique({
    where: {
      userId_bootcampId: {
        userId,
        bootcampId,
      },
    },
  });
}

/**
 * Fetch all enrollments for a specific user.
 * Includes nested bootcamp details.
 * @param {string} userId - UUID of the user.
 * @returns {Promise<Array>} List of enrollments with bootcamp data.
 */
export async function findUserEnrollments(userId) {
  return await prisma.enrollment.findMany({
    where: { userId },
    include: {
      bootcamp: true, // This is a "Join" - it fetches bootcamp details in one query
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Fetch all students enrolled in a specific bootcamp.
 * Includes nested user details.
 * @param {string} bootcampId - UUID of the bootcamp.
 * @returns {Promise<Array>} List of enrollments with user data.
 */
export async function findBootcampEnrollments(bootcampId) {
  return await prisma.enrollment.findMany({
    where: { bootcampId },
    include: {
      user: true, // This is a "Join" - it fetches user details in one query
    },
    orderBy: { createdAt: "desc" },
  });
}
