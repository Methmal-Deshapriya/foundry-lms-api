import prisma from "./prisma.js";
import { ForbiddenError, NotFoundError } from "./Errors.js";

/**
 * Access Helpers
 * Centralizes resource-scoped authorization checks.
 */

/**
 * Assert that a user has an active enrollment in a specific bootcamp.
 * @param {string} userId
 * @param {string} bootcampId
 * @throws {ForbiddenError} if enrollment is not found or not active.
 */
export async function assertEnrollmentAccess(userId, bootcampId) {
  const enrollment = await prisma.enrollment.findUnique({
    where: {
      userId_bootcampId: { userId, bootcampId },
    },
  });

  if (!enrollment || enrollment.status === "CANCELLED") {
    throw new ForbiddenError("You must be enrolled in this bootcamp to access this resource.");
  }

  return enrollment;
}

/**
 * Assert that a user owns a specific enrollment.
 * @param {string} userId
 * @param {string} enrollmentId
 * @throws {ForbiddenError} if ownership is not verified.
 */
export async function assertEnrollmentOwnership(userId, enrollmentId) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
  });

  if (!enrollment) {
    throw new NotFoundError("Enrollment not found.");
  }

  if (enrollment.userId !== userId) {
    throw new ForbiddenError("You do not have permission to access this enrollment.");
  }

  return enrollment;
}

/**
 * Assert that a user owns a specific project.
 * @param {string} userId
 * @param {string} projectId
 * @throws {ForbiddenError} if ownership is not verified.
 */
export async function assertProjectOwnership(userId, projectId) {
  const project = await prisma.studentProject.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new NotFoundError("Project not found.");
  }

  if (project.userId !== userId) {
    throw new ForbiddenError("You do not have permission to access this project.");
  }

  return project;
}
