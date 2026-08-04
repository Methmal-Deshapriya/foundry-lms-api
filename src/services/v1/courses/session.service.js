import * as sessionRepo from "../../../repositories/v1/courses/session.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import * as completionRepo from "../../../repositories/v1/courses/sessionCompletion.repository.js";
import {
  createSessionSchema,
  updateSessionSchema,
  reorderSessionsSchema,
} from "../../../constants/v1/courses/session.schema.js";
import { assertEnrollmentAccess } from "../../../utils/accessHelpers.js";
import { ValidationError, NotFoundError } from "../../../utils/Errors.js";
import { transformSession, transformSessionList } from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { assertCourseAcceptsOperationalChanges } from "../catalog/courseLifecycle.service.js";

function parse(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(
      firstError?.message || "Validation failed",
      firstError?.path?.[0] || "unknown"
    );
  }
  return validation.data;
}

export async function createSessionService(courseId, data, actorId) {
  const sessionData = parse(createSessionSchema, data);
  const course = await courseRepo.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  assertCourseAcceptsOperationalChanges(course);

  const session = await sessionRepo.create(courseId, sessionData);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_CREATED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: session.id,
    description: `Session "${session.title}" created for course "${course.title}"`,
    metadata: { courseId, ...sessionData },
  });
  return transformSession(session);
}

export async function updateSessionService(id, data, actorId) {
  const sessionData = parse(updateSessionSchema, data);
  const session = await sessionRepo.findById(id);
  if (!session) throw new NotFoundError("Session not found.");
  const course = await courseRepo.findById(session.courseId);
  if (!course) throw new NotFoundError("Course not found.");
  assertCourseAcceptsOperationalChanges(course);

  const updated = await sessionRepo.update(id, sessionData);
  const publicationChanged =
    sessionData.isPublished !== undefined &&
    sessionData.isPublished !== session.isPublished;
  recordActionService({
    actorUserId: actorId,
    action: publicationChanged
      ? sessionData.isPublished
        ? AUDIT_ACTIONS.SESSION_PUBLISHED
        : AUDIT_ACTIONS.SESSION_UNPUBLISHED
      : AUDIT_ACTIONS.SESSION_UPDATED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: id,
    description: publicationChanged
      ? `Session "${session.title}" ${sessionData.isPublished ? "published" : "unpublished"}`
      : `Session "${session.title}" updated`,
  });
  return transformSession(updated);
}

export async function deleteSessionService(id, actorId) {
  const session = await sessionRepo.findById(id);
  if (!session) throw new NotFoundError("Session not found.");
  const course = await courseRepo.findById(session.courseId);
  if (!course) throw new NotFoundError("Course not found.");
  assertCourseAcceptsOperationalChanges(course);
  await sessionRepo.remove(id);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_DELETED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: id,
    description: `Session "${session.title}" deleted`,
  });
  return { id };
}

export async function reorderSessionsService(courseId, data, actorId) {
  const { sessions } = parse(reorderSessionsSchema, data);
  const ids = sessions.map(({ id }) => id);
  const indexes = sessions.map(({ orderIndex }) => orderIndex);
  const expectedIndexes = sessions.map((_, index) => index);
  if (
    new Set(ids).size !== ids.length ||
    new Set(indexes).size !== indexes.length ||
    [...indexes].sort((a, b) => a - b).some((value, index) => value !== expectedIndexes[index])
  ) {
    throw new ValidationError(
      "Sessions must be unique and use continuous order indexes starting at zero.",
      "sessions"
    );
  }

  const course = await courseRepo.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  assertCourseAcceptsOperationalChanges(course);
  await sessionRepo.reorder(courseId, sessions);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_REORDERED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: courseId,
    description: `Sessions reordered for course "${course.title}"`,
  });
  return { success: true };
}

export async function getSessionsAdminService(courseId) {
  const course = await courseRepo.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  return transformSessionList(await sessionRepo.findByCourseIdAdmin(courseId));
}

export async function getSessionsStudentService(courseId, userId) {
  const enrollment = await assertEnrollmentAccess(userId, courseId);
  const [sessions, completions] = await Promise.all([
    sessionRepo.findByCourseIdPublic(courseId),
    completionRepo.findByEnrollmentId(enrollment.id),
  ]);
  const completedIds = new Set(completions.map(({ sessionId }) => sessionId));
  return transformSessionList(
    sessions.map((session) => ({
      ...session,
      isCompleted: completedIds.has(session.id),
    }))
  );
}

export async function getSessionDetailsService(sessionId, userId, isAdmin = false) {
  const session = await sessionRepo.findById(sessionId);
  if (!session) throw new NotFoundError("Session not found.");
  if (!isAdmin) {
    await assertEnrollmentAccess(userId, session.courseId);
    if (!session.isPublished) throw new NotFoundError("Session not found.");
  }
  return transformSession(session);
}
