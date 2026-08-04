import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Session Completion Repository
 * Tracks which students have completed which sessions.
 */

/**
 * Mark a session as completed for a specific enrollment.
 */
export async function create(sessionId, enrollmentId) {
  try {
    return await prisma.sessionCompletion.create({
      data: {
        sessionId,
        enrollmentId,
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Unmark a session as completed.
 */
export async function remove(sessionId, enrollmentId) {
  try {
    return await prisma.sessionCompletion.delete({
      where: {
        sessionId_enrollmentId: {
          sessionId,
          enrollmentId,
        },
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Find a specific completion record.
 */
export async function findUnique(sessionId, enrollmentId) {
  return await prisma.sessionCompletion.findUnique({
    where: {
      sessionId_enrollmentId: {
        sessionId,
        enrollmentId,
      },
    },
  });
}

/**
 * Get all completions for a specific enrollment.
 */
export async function findByEnrollmentId(enrollmentId) {
  return await prisma.sessionCompletion.findMany({
    where: { enrollmentId },
  });
}

/**
 * Count completed published sessions for an enrollment.
 */
export async function countCompletedPublishedByEnrollment(enrollmentId, courseId) {
  return await prisma.sessionCompletion.count({
    where: {
      enrollmentId,
      session: {
        courseId,
        isPublished: true,
      },
    },
  });
}
