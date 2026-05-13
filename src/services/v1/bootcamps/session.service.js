import * as sessionRepo from "../../../repositories/v1/bootcamps/session.repository.js";
import * as bootcampRepo from "../../../repositories/v1/bootcamps/bootcamp.repository.js";
import * as completionRepo from "../../../repositories/v1/bootcamps/sessionCompletion.repository.js";
import { createSessionSchema, updateSessionSchema, reorderSessionsSchema } from "../../../constants/v1/bootcamps/session.schema.js";
import { assertEnrollmentAccess } from "../../../utils/accessHelpers.js";
import { ValidationError, NotFoundError } from "../../../utils/Errors.js";
import { transformSession, transformSessionList } from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";

/**
 * Session Service
 * Manages the logic for bootcamp sessions.
 */

/**
 * Service: Create a new session (Admin).
 */
export async function createSessionService(bootcampId, data, actorId) {
  // 1. Validation
  const validation = createSessionSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Existence Check
  const bootcamp = await bootcampRepo.findById(bootcampId);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }

  // 3. Action
  const session = await sessionRepo.create(bootcampId, validation.data);

  // 4. Audit
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_CREATED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: session.id,
    description: `Session "${session.title}" created for bootcamp "${bootcamp.title}"`,
    metadata: { bootcampId, ...validation.data }
  });

  return transformSession(session);
}

/**
 * Service: Update a session (Admin).
 */
export async function updateSessionService(id, data, actorId) {
  // 1. Validation
  const validation = updateSessionSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Existence Check
  const session = await sessionRepo.findById(id);
  if (!session) {
    throw new NotFoundError("Session not found.");
  }

  // 3. Action
  const updated = await sessionRepo.update(id, validation.data);

  // 4. Audit
  if (validation.data.isPublished !== undefined && validation.data.isPublished !== session.isPublished) {
    recordActionService({
      actorUserId: actorId,
      action: validation.data.isPublished ? AUDIT_ACTIONS.SESSION_PUBLISHED : AUDIT_ACTIONS.SESSION_UNPUBLISHED,
      entityType: ENTITY_TYPES.SESSION,
      entityId: id,
      description: `Session "${session.title}" ${validation.data.isPublished ? "published" : "unpublished"}`,
    });
  } else {
    recordActionService({
      actorUserId: actorId,
      action: AUDIT_ACTIONS.SESSION_UPDATED,
      entityType: ENTITY_TYPES.SESSION,
      entityId: id,
      description: `Session "${session.title}" updated`,
    });
  }

  return transformSession(updated);
}

/**
 * Service: Delete a session (Admin).
 */
export async function deleteSessionService(id, actorId) {
  const session = await sessionRepo.findById(id);
  if (!session) {
    throw new NotFoundError("Session not found.");
  }

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

/**
 * Service: Reorder sessions (Admin).
 */
export async function reorderSessionsService(bootcampId, data, actorId) {
  // 1. Validation
  const validation = reorderSessionsSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Action
  await sessionRepo.reorder(validation.data.sessions);

  // 3. Audit
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_REORDERED,
    entityType: ENTITY_TYPES.BOOTCAMP,
    entityId: bootcampId,
    description: `Sessions reordered for bootcamp ${bootcampId}`,
  });

  return { success: true };
}

/**
 * Service: Get sessions for a bootcamp (Admin).
 */
export async function getSessionsAdminService(bootcampId) {
  const sessions = await sessionRepo.findByBootcampIdAdmin(bootcampId);
  return transformSessionList(sessions);
}

/**
 * Service: Get sessions for a bootcamp (Student).
 * Enforces enrollment access.
 */
export async function getSessionsStudentService(bootcampId, userId) {
  // 1. Assert Access
  const enrollment = await assertEnrollmentAccess(userId, bootcampId);

  // 2. Fetch
  const [sessions, enrollmentCompletions] = await Promise.all([
    sessionRepo.findByBootcampIdPublic(bootcampId),
    completionRepo.findByEnrollmentId(enrollment.id),
  ]);
  const completedSessionIds = new Set(enrollmentCompletions.map((completion) => completion.sessionId));

  return transformSessionList(
    sessions.map((session) => ({
      ...session,
      isCompleted: completedSessionIds.has(session.id),
    }))
  );
}

/**
 * Service: Get a single session details.
 */
export async function getSessionDetailsService(sessionId, userId, isAdmin = false) {
  const session = await sessionRepo.findById(sessionId);
  if (!session) {
    throw new NotFoundError("Session not found.");
  }

  if (!isAdmin) {
    // Assert student has access to the bootcamp this session belongs to
    await assertEnrollmentAccess(userId, session.bootcampId);
    
    if (!session.isPublished) {
      throw new NotFoundError("Session not found."); // Hide unpublished from students
    }
  }

  return transformSession(session);
}
