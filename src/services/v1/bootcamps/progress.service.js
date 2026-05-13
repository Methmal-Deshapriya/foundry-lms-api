import * as completionRepo from "../../../repositories/v1/bootcamps/sessionCompletion.repository.js";
import * as sessionRepo from "../../../repositories/v1/bootcamps/session.repository.js";
import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import { assertEnrollmentAccess, assertEnrollmentOwnership } from "../../../utils/accessHelpers.js";
import { NotFoundError, ConflictError, ForbiddenError } from "../../../utils/Errors.js";

/**
 * Progress Service
 * Handles session completions and derived progress calculation.
 */

/**
 * Service: Mark a session as complete.
 */
export async function markSessionCompleteService(sessionId, userId) {
  // 1. Find session
  const session = await sessionRepo.findById(sessionId);
  if (!session) {
    throw new NotFoundError("Session not found.");
  }
  if (!session.isPublished) {
    throw new ForbiddenError("You can only complete published sessions.");
  }

  // 2. Find enrollment (Student must be enrolled in the bootcamp the session belongs to)
  const enrollment = await enrollmentRepo.findExisting(userId, session.bootcampId);
  if (!enrollment || enrollment.status === "CANCELLED") {
    throw new ForbiddenError("You are not enrolled in this bootcamp.");
  }

  // 3. Duplicate check
  const existing = await completionRepo.findUnique(sessionId, enrollment.id);
  if (existing) {
    return existing; // Already completed, idempotent success
  }

  // 4. Action
  return await completionRepo.create(sessionId, enrollment.id);
}

/**
 * Service: Unmark a session as complete.
 */
export async function unmarkSessionCompleteService(sessionId, userId) {
  const session = await sessionRepo.findById(sessionId);
  if (!session) {
    throw new NotFoundError("Session not found.");
  }
  if (!session.isPublished) {
    throw new ForbiddenError("You can only unmark published sessions.");
  }

  const enrollment = await enrollmentRepo.findExisting(userId, session.bootcampId);
  if (!enrollment) {
    throw new ForbiddenError("You are not enrolled in this bootcamp.");
  }

  try {
    await completionRepo.remove(sessionId, enrollment.id);
  } catch (error) {
    // If it didn't exist, we consider it "unmarked" successfully (idempotent)
  }

  return { success: true };
}

/**
 * Service: Get derived progress for an enrollment.
 */
export async function getProgressService(enrollmentId, userId, isAdmin = false) {
  // 1. Fetch enrollment
  const enrollment = await enrollmentRepo.findById(enrollmentId);
  if (!enrollment) {
    throw new NotFoundError("Enrollment not found.");
  }

  // 2. Access check
  if (!isAdmin && enrollment.userId !== userId) {
    throw new ForbiddenError("Access denied.");
  }

  // 3. Progress calculation
  // Formula: completed published sessions / total published sessions * 100
  
  const [completedCount, totalPublishedSessions] = await Promise.all([
    completionRepo.countCompletedPublishedByEnrollment(enrollment.id, enrollment.bootcampId),
    sessionRepo.countPublishedByBootcamp(enrollment.bootcampId),
  ]);

  const progressPercent = totalPublishedSessions > 0 
    ? Math.round((completedCount / totalPublishedSessions) * 100) 
    : 0;

  return {
    enrollmentId: enrollment.id,
    bootcampId: enrollment.bootcampId,
    completedCount,
    totalPublishedSessions,
    progressPercent,
  };
}
