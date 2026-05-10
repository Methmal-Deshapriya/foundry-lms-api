import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Session Repository
 * Handles all database operations for bootcamp sessions.
 */

/**
 * Fetch all sessions for a bootcamp (Admin).
 */
export async function findByBootcampIdAdmin(bootcampId) {
  return await prisma.session.findMany({
    where: { bootcampId },
    orderBy: { orderIndex: "asc" },
  });
}

/**
 * Fetch published sessions for a bootcamp (Student/Public).
 */
export async function findByBootcampIdPublic(bootcampId) {
  return await prisma.session.findMany({
    where: {
      bootcampId,
      isPublished: true,
    },
    orderBy: { orderIndex: "asc" },
  });
}

/**
 * Find a specific session by ID.
 */
export async function findById(id) {
  return await prisma.session.findUnique({
    where: { id },
  });
}

/**
 * Create a new session.
 */
export async function create(bootcampId, data) {
  try {
    return await prisma.session.create({
      data: {
        ...data,
        bootcampId,
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Update an existing session.
 */
export async function update(id, data) {
  try {
    return await prisma.session.update({
      where: { id },
      data,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Delete a session.
 */
export async function remove(id) {
  try {
    return await prisma.session.delete({
      where: { id },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Count published sessions for a bootcamp.
 */
export async function countPublishedByBootcamp(bootcampId) {
  return await prisma.session.count({
    where: {
      bootcampId,
      isPublished: true,
    },
  });
}
