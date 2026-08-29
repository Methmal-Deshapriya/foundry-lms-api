import * as sessionRepo from "../../../repositories/v1/sessions/sessionLibrary.repository.js";
import {
  bulkArchiveSessionsSchema,
  createSessionLibrarySchema,
  sessionLibraryFiltersSchema,
  updateSessionLibrarySchema,
} from "../../../constants/v1/sessions/sessionLibrary.schema.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../utils/Errors.js";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
} from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";

function parse(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return validation.data;
}

function toSessionLibraryResponse(session) {
  const courseUsages = session.courseSessions ?? [];
  const usage = {
    courseCount: courseUsages.length,
    activeCourseCount: courseUsages.filter(({ retiredAt }) => !retiredAt).length,
    courseGroupCount: new Set(courseUsages.map(({ course }) => course?.courseGroupId)).size,
    courses: courseUsages.map((courseSession) => ({
      courseSessionId: courseSession.id,
      courseId: courseSession.courseId,
      courseTitle: courseSession.course?.title,
      courseCode: courseSession.course?.code,
      courseGroupId: courseSession.course?.courseGroupId,
      courseGroupTitle: courseSession.course?.courseGroup?.title,
      categoryId: courseSession.course?.categoryId,
      categoryTitle: courseSession.course?.category?.title,
      serviceSlug: courseSession.course?.category?.service?.slug,
      serviceTitle: courseSession.course?.category?.service?.title,
      orderIndex: courseSession.orderIndex,
      retiredAt: courseSession.retiredAt,
      deliveryStatus: courseSession.deliveryStatus,
    })),
  };

  return {
    ...session,
    courseSessions: undefined,
    usage,
  };
}

export async function listSessionLibraryService(query) {
  const filters = parse(sessionLibraryFiltersSchema, query);
  const { limit, offset, ...where } = filters;
  const result = await sessionRepo.findAdmin(where, limit, offset);
  return {
    sessions: result.sessions.map(toSessionLibraryResponse),
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.sessions.length < result.total,
    },
  };
}

export async function getSessionLibraryItemService(id) {
  const session = await sessionRepo.findById(id);
  if (!session) throw new NotFoundError("Session not found.");
  return toSessionLibraryResponse(session);
}

export async function createSessionLibraryItemService(data, actorId) {
  const input = parse(createSessionLibrarySchema, data);
  const session = await sessionRepo.create(input);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_CREATED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: session.id,
    description: `Session "${session.title}" created in the library.`,
    metadata: { status: session.status },
  });
  return toSessionLibraryResponse(session);
}

export async function updateSessionLibraryItemService(id, data, actorId) {
  const input = parse(updateSessionLibrarySchema, data);
  const { previous: current, session: updated, changedFields } =
    await sessionRepo.updateSafely(id, input);
  if (changedFields.length === 0) return toSessionLibraryResponse(updated);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_UPDATED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: id,
    description: `Session "${current.title}" updated in the library.`,
    metadata: {
      changedFields,
      affectedCourses: current.courseSessions.length,
      affectedCourseGroups: new Set(current.courseSessions.map(({ course }) => course?.courseGroupId)).size,
    },
  });
  return toSessionLibraryResponse(updated);
}

export async function archiveSessionLibraryItemService(id, actorId) {
  const { previous: current, session, changed } =
    await sessionRepo.archiveSafely(id);
  if (!changed) return toSessionLibraryResponse(session);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_ARCHIVED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: id,
    description: `Session "${current.title}" archived. Existing delivery access is preserved.`,
    metadata: {
      affectedCourses: current.courseSessions.length,
      affectedCourseGroups: new Set(current.courseSessions.map(({ course }) => course?.courseGroupId)).size,
    },
  });
  return toSessionLibraryResponse(session);
}

export async function unarchiveSessionLibraryItemService(id, actorId) {
  const { previous: current, session, restoredStatus } =
    await sessionRepo.restoreSafely(id);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_UNARCHIVED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: id,
    description: `Session "${current.title}" restored as ${restoredStatus.toLowerCase()}.`,
    metadata: {
      restoredStatus,
      affectedCourses: current.courseSessions.length,
    },
  });
  return toSessionLibraryResponse(session);
}

export async function duplicateSessionLibraryItemService(id, actorId) {
  const source = await sessionRepo.findById(id);
  if (!source) throw new NotFoundError("Session not found.");
  const session = await sessionRepo.duplicate(id);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_DUPLICATED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: session.id,
    description: `Session "${source.title}" duplicated as "${session.title}".`,
    metadata: { sourceSessionId: id },
  });
  return toSessionLibraryResponse(session);
}

export async function bulkArchiveSessionLibraryItemsService(data, actorId) {
  const { ids } = parse(bulkArchiveSessionsSchema, data);
  const results = await sessionRepo.archiveMany(ids);

  for (const result of results) {
    if (result.status !== "ARCHIVED" || !result.changed) continue;
    recordActionService({
      actorUserId: actorId,
      action: AUDIT_ACTIONS.SESSION_ARCHIVED,
      entityType: ENTITY_TYPES.SESSION,
      entityId: result.id,
      description: `Session "${result.title}" archived. Existing delivery access is preserved.`,
      metadata: {
        affectedCourses: result.session.courseSessions?.length ?? 0,
      },
    });
  }

  const archivedCount = results.filter(({ status }) => status === "ARCHIVED").length;
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_BULK_ARCHIVED,
    entityType: ENTITY_TYPES.SESSION,
    entityId: null,
    description: `${archivedCount} of ${ids.length} library session(s) archived in bulk.`,
    metadata: { requestedCount: ids.length, archivedCount, failedCount: ids.length - archivedCount },
  });

  return {
    results: results.map(({ id, status, error }) => ({ id, status, error })),
    summary: {
      requested: ids.length,
      archived: archivedCount,
      failed: ids.length - archivedCount,
    },
  };
}

export async function deleteSessionLibraryItemPermanentlyService(id, actorId) {
  const current = await sessionRepo.findById(id);
  if (!current) throw new NotFoundError("Session not found.");
  if (current.status !== "ARCHIVED") {
    throw new ConflictError("Archive the session before permanently deleting it.");
  }
  if (current.courseSessions.length > 0) {
    throw new ConflictError(
      "This session has curriculum or delivery history and cannot be permanently deleted.",
    );
  }
  const result = await sessionRepo.removePermanently(id);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.SESSION_DELETED_PERMANENTLY,
    entityType: ENTITY_TYPES.SESSION,
    entityId: id,
    description: `Session "${current.title}" permanently deleted from the library.`,
    metadata: { title: current.title },
  });
  return result;
}
