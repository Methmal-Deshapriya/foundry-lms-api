import * as completionRepo from "../../../repositories/v1/courses/sessionCompletion.repository.js";
import * as sessionRepo from "../../../repositories/v1/courses/session.repository.js";
import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import { NotFoundError, ForbiddenError } from "../../../utils/Errors.js";

export async function markSessionCompleteService(sessionId, userId) {
  const session = await sessionRepo.findById(sessionId);
  if (!session) throw new NotFoundError("Session not found.");
  if (!session.isPublished) {
    throw new ForbiddenError("You can only complete published sessions.");
  }

  const enrollment = await enrollmentRepo.findExisting(userId, session.courseId);
  if (!enrollment || enrollment.status === "CANCELLED") {
    throw new ForbiddenError("You are not enrolled in this course.");
  }
  const existing = await completionRepo.findUnique(sessionId, enrollment.id);
  return existing || completionRepo.create(sessionId, enrollment.id);
}

export async function unmarkSessionCompleteService(sessionId, userId) {
  const session = await sessionRepo.findById(sessionId);
  if (!session) throw new NotFoundError("Session not found.");
  if (!session.isPublished) {
    throw new ForbiddenError("You can only unmark published sessions.");
  }
  const enrollment = await enrollmentRepo.findExisting(userId, session.courseId);
  if (!enrollment || enrollment.status === "CANCELLED") {
    throw new ForbiddenError("You are not enrolled in this course.");
  }
  const existing = await completionRepo.findUnique(sessionId, enrollment.id);
  if (existing) await completionRepo.remove(sessionId, enrollment.id);
  return { success: true };
}

export async function getProgressService(enrollmentId, userId, isAdmin = false) {
  const enrollment = await enrollmentRepo.findById(enrollmentId);
  if (!enrollment) throw new NotFoundError("Enrollment not found.");
  if (!isAdmin && enrollment.userId !== userId) {
    throw new ForbiddenError("Access denied.");
  }
  const [completedCount, totalPublishedSessions] = await Promise.all([
    completionRepo.countCompletedPublishedByEnrollment(enrollment.id, enrollment.courseId),
    sessionRepo.countPublishedByCourse(enrollment.courseId),
  ]);
  return {
    enrollmentId: enrollment.id,
    courseId: enrollment.courseId,
    completedCount,
    totalPublishedSessions,
    progressPercent:
      totalPublishedSessions > 0
        ? Math.round((completedCount / totalPublishedSessions) * 100)
        : 0,
  };
}
