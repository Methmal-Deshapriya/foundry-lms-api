import * as batchRepo from "../../../repositories/v1/batches/batch.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  batchFiltersSchema,
  createBatchSchema,
  reorderBatchSessionsSchema,
  updateBatchSchema,
  updateBatchStatusSchema,
  upsertBatchSessionSchema,
} from "../../../constants/v1/batches/batch.schema.js";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
} from "../../../constants/v1/audit/audit.constants.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { assertCourseAcceptsOperationalChanges } from "../catalog/courseLifecycle.service.js";
import { assertCohortService } from "../catalog/learningServicePolicy.service.js";

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  DRAFT: ["ENROLLING", "CANCELLED", "ARCHIVED"],
  ENROLLING: ["DRAFT", "ACTIVE", "CANCELLED", "ARCHIVED"],
  ACTIVE: ["COMPLETED", "CANCELLED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
});

function parse(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return validation.data;
}

function toBatchResponse(batch) {
  return {
    ...batch,
    sessionCount: batch._count?.sessions ?? 0,
    enrollmentCount: batch._count?.enrollments ?? 0,
    _count: undefined,
  };
}

function availabilityState(batchSession, now = new Date()) {
  if (!batchSession.isReleased) return "HIDDEN";
  if (batchSession.availableAt && batchSession.availableAt > now) return "SCHEDULED";
  return "AVAILABLE";
}

function toBatchSessionResponse(batchSession) {
  return {
    ...batchSession,
    state: availabilityState(batchSession),
  };
}

function isCatalogArchived(batch) {
  return (
    batch.course.status === "ARCHIVED" ||
    batch.course.category.status === "ARCHIVED"
  );
}

async function requireCohortCourse(courseId, { operational = false } = {}) {
  const course = await courseRepo.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  assertCohortService(course.category.serviceType);
  if (operational) assertCourseAcceptsOperationalChanges(course);
  return course;
}

async function requireBatch(batchId) {
  const batch = await batchRepo.findById(batchId);
  if (!batch) throw new NotFoundError("Batch not found.");
  assertCohortService(batch.course.category.serviceType);
  return batch;
}

function assertBatchSetupMutable(batch) {
  if (!["DRAFT", "ENROLLING"].includes(batch.status)) {
    throw new ConflictError("Only draft or enrolling batches can change setup.");
  }
  assertCourseAcceptsOperationalChanges(batch.course);
}

function assertBatchDeliveryMutable(batch) {
  if (!["DRAFT", "ENROLLING", "ACTIVE"].includes(batch.status)) {
    throw new ConflictError("This batch no longer accepts delivery changes.");
  }
}

export async function listCourseBatchesService(courseId, query = {}) {
  await requireCohortCourse(courseId);
  const filters = parse(batchFiltersSchema, query);
  const { limit, offset, ...where } = filters;
  const result = await batchRepo.findAdminByCourse(courseId, where, limit, offset);
  return {
    batches: result.batches.map(toBatchResponse),
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.batches.length < result.total,
    },
  };
}

export async function getBatchService(batchId) {
  return toBatchResponse(await requireBatch(batchId));
}

export async function createBatchService(courseId, data, actorId) {
  const input = parse(createBatchSchema, data);
  const course = await requireCohortCourse(courseId, { operational: true });
  const { initializeCurriculum, ...batchData } = input;
  const result = await batchRepo.create(
    courseId,
    { ...batchData, status: "DRAFT" },
    initializeCurriculum,
  );
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BATCH_CREATED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: result.batch.id,
    description: `Batch "${result.batch.name}" created for course "${course.title}".`,
    metadata: {
      courseId,
      code: result.batch.code,
      initializedSessionCount: result.initializedSessionCount,
    },
  });
  return {
    batch: toBatchResponse(result.batch),
    initializedSessionCount: result.initializedSessionCount,
  };
}

export async function updateBatchService(batchId, data, actorId) {
  const input = parse(updateBatchSchema, data);
  const batch = await requireBatch(batchId);
  assertBatchSetupMutable(batch);
  const startDate = input.startDate ?? batch.startDate;
  const expectedEndDate = input.expectedEndDate ?? batch.expectedEndDate;
  if (expectedEndDate < startDate) {
    throw new ValidationError(
      "Expected end date cannot be before the start date.",
      "expectedEndDate",
    );
  }
  const updated = await batchRepo.update(batchId, input);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BATCH_UPDATED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: batchId,
    description: `Batch "${batch.name}" updated.`,
    metadata: { changedFields: Object.keys(input), courseId: batch.courseId },
  });
  return toBatchResponse(updated);
}

export async function updateBatchStatusService(batchId, data, actorId) {
  const { status } = parse(updateBatchStatusSchema, data);
  const batch = await requireBatch(batchId);
  if (status === batch.status) return toBatchResponse(batch);
  if (!ALLOWED_STATUS_TRANSITIONS[batch.status].includes(status)) {
    throw new ConflictError(
      `Batch status cannot move from ${batch.status} to ${status}.`,
    );
  }
  if (
    isCatalogArchived(batch) &&
    !(batch.status === "ACTIVE" && ["COMPLETED", "CANCELLED", "ARCHIVED"].includes(status))
  ) {
    throw new ConflictError(
      "Archived catalog records allow an active batch only to finish, cancel, or archive.",
    );
  }
  const updated = await batchRepo.update(batchId, { status });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BATCH_STATUS_CHANGED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: batchId,
    description: `Batch "${batch.name}" moved from ${batch.status} to ${status}.`,
    metadata: { oldStatus: batch.status, newStatus: status, courseId: batch.courseId },
  });
  return toBatchResponse(updated);
}

export async function initializeBatchCurriculumService(batchId, actorId) {
  const batch = await requireBatch(batchId);
  assertBatchSetupMutable(batch);
  const result = await batchRepo.initializeCurriculum(batchId);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BATCH_CURRICULUM_INITIALIZED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: batchId,
    description: `Curriculum initialized for batch "${batch.name}".`,
    metadata: { courseId: batch.courseId, ...result },
  });
  return result;
}

export async function getBatchSessionsService(batchId) {
  const batch = await requireBatch(batchId);
  const sessions = await batchRepo.findSessions(batchId);
  return {
    batch: {
      id: batch.id,
      name: batch.name,
      code: batch.code,
      status: batch.status,
      courseId: batch.courseId,
      courseTitle: batch.course.title,
    },
    sessions: sessions.map(toBatchSessionResponse),
  };
}

export async function upsertBatchSessionService(
  batchId,
  courseSessionId,
  data,
  actorId,
) {
  const input = parse(upsertBatchSessionSchema, data);
  if (!input.isReleased && input.availableAt) {
    throw new ValidationError(
      "A hidden batch session cannot have an availability time.",
      "availableAt",
    );
  }
  const batch = await requireBatch(batchId);
  assertBatchDeliveryMutable(batch);
  const existing = await batchRepo.findSession(batchId, courseSessionId);
  if (isCatalogArchived(batch) && !existing) {
    throw new ConflictError(
      "Archived courses cannot add new sessions, but active batches may release existing assignments.",
    );
  }
  if (input.isReleased && batch.status !== "ACTIVE") {
    throw new ConflictError("Sessions can be released only while the batch is active.");
  }

  const batchSession = await batchRepo.upsertSession(
    batchId,
    courseSessionId,
    input,
  );
  const action = !existing
    ? AUDIT_ACTIONS.BATCH_SESSION_ADDED
    : input.isReleased && !existing.isReleased
      ? AUDIT_ACTIONS.BATCH_SESSION_RELEASED
      : !input.isReleased && existing.isReleased
        ? AUDIT_ACTIONS.BATCH_SESSION_WITHDRAWN
        : AUDIT_ACTIONS.BATCH_SESSION_UPDATED;
  recordActionService({
    actorUserId: actorId,
    action,
    entityType: ENTITY_TYPES.BATCH_SESSION,
    entityId: batchSession.id,
    description: `Batch session "${batchSession.courseSession.session.title}" updated for "${batch.name}".`,
    metadata: {
      batchId,
      courseId: batch.courseId,
      courseSessionId,
      state: availabilityState(batchSession),
      availableAt: batchSession.availableAt,
    },
  });
  return toBatchSessionResponse(batchSession);
}

export async function reorderBatchSessionsService(batchId, data, actorId) {
  const { batchSessions } = parse(reorderBatchSessionsSchema, data);
  const ids = batchSessions.map(({ id }) => id);
  const indexes = batchSessions.map(({ orderIndex }) => orderIndex);
  const expected = batchSessions.map((_, index) => index);
  if (
    new Set(ids).size !== ids.length ||
    new Set(indexes).size !== indexes.length ||
    [...indexes].sort((left, right) => left - right).some(
      (value, index) => value !== expected[index],
    )
  ) {
    throw new ValidationError(
      "Batch sessions must be unique and use continuous order indexes from zero.",
      "batchSessions",
    );
  }
  const batch = await requireBatch(batchId);
  assertBatchDeliveryMutable(batch);
  await batchRepo.reorderSessions(batchId, batchSessions);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BATCH_SESSIONS_REORDERED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: batchId,
    description: `Delivery order updated for batch "${batch.name}".`,
    metadata: { courseId: batch.courseId, batchSessionIds: ids },
  });
  return { success: true };
}

export async function removeBatchSessionService(
  batchId,
  courseSessionId,
  actorId,
) {
  const batch = await requireBatch(batchId);
  assertBatchDeliveryMutable(batch);
  const result = await batchRepo.removeOrWithdrawSession(batchId, courseSessionId);
  recordActionService({
    actorUserId: actorId,
    action:
      result.action === "WITHDRAWN"
        ? AUDIT_ACTIONS.BATCH_SESSION_WITHDRAWN
        : AUDIT_ACTIONS.BATCH_SESSION_REMOVED,
    entityType: ENTITY_TYPES.BATCH_SESSION,
    entityId: result.id,
    description: `Batch session ${result.action.toLowerCase()} for "${batch.name}".`,
    metadata: { batchId, courseId: batch.courseId, courseSessionId, ...result },
  });
  return result;
}

