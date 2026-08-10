import * as batchRepo from "../../../repositories/v1/batches/batch.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  batchFiltersSchema,
  createBatchSchema,
  updateBatchSchema,
  updateBatchSessionDeliverySchema,
  updateBatchStatusSchema,
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
    sessionCount: batch.course?._count?.courseSessions ?? 0,
    enrollmentCount: batch._count?.enrollments ?? 0,
    course: batch.course
      ? { ...batch.course, _count: undefined }
      : batch.course,
    _count: undefined,
  };
}

function availabilityState(batchSession, now = new Date()) {
  if (batchSession.inherited) return "UNRELEASED";
  if (!batchSession.isReleased) return "WITHDRAWN";
  if (batchSession.availableAt && batchSession.availableAt > now) return "SCHEDULED";
  return "RELEASED";
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
  const batch = await requireBatch(batchId);
  const completionReadiness = await batchRepo.findCompletionReadiness(batchId);
  return { ...toBatchResponse(batch), completionReadiness };
}

export async function createBatchService(courseId, data, actorId) {
  const input = parse(createBatchSchema, data);
  const course = await requireCohortCourse(courseId, { operational: true });
  const batch = await batchRepo.create(courseId, { ...input, status: "DRAFT" });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BATCH_CREATED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: batch.id,
    description: `Batch "${batch.name}" created for course "${course.title}".`,
    metadata: {
      courseId,
      code: batch.code,
      curriculumMode: "LIVE_INHERITED",
    },
  });
  return { batch: toBatchResponse(batch), curriculumMode: "LIVE_INHERITED" };
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
  const { batch: updated, completionReadiness } =
    await batchRepo.transitionStatus(batchId, batch.status, status, {
      requireCompletionReadiness: status === "COMPLETED",
    });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BATCH_STATUS_CHANGED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: batchId,
    description: `Batch "${batch.name}" moved from ${batch.status} to ${status}.`,
    metadata: {
      oldStatus: batch.status,
      newStatus: status,
      courseId: batch.courseId,
      completionReadiness,
    },
  });
  return { ...toBatchResponse(updated), completionReadiness };
}

export async function getBatchSessionsService(batchId) {
  const batch = await requireBatch(batchId);
  const sessions = await batchRepo.findSessions(batchId);
  const completionReadiness = await batchRepo.findCompletionReadiness(batchId);
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
    completionReadiness,
  };
}

export async function updateBatchSessionDeliveryService(
  batchId,
  courseSessionId,
  data,
  actorId,
) {
  const input = parse(updateBatchSessionDeliverySchema, data);
  const batch = await requireBatch(batchId);
  assertBatchDeliveryMutable(batch);
  const existing = await batchRepo.findSession(batchId, courseSessionId);
  if (!existing) {
    throw new NotFoundError("Course session is not part of this batch curriculum.");
  }
  if (input.mode !== "UNRELEASED" && batch.status !== "ACTIVE") {
    throw new ConflictError(
      "Sessions can be released or scheduled only while the batch is active.",
    );
  }

  const batchSession = await batchRepo.updateDelivery(
    batchId,
    courseSessionId,
    input,
  );
  const action = input.mode !== "UNRELEASED" && !existing.isReleased
      ? AUDIT_ACTIONS.BATCH_SESSION_RELEASED
      : input.mode === "UNRELEASED" && existing.isReleased
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
      acknowledgeSequenceRisk: input.acknowledgeSequenceRisk,
    },
  });
  return toBatchSessionResponse(batchSession);
}
