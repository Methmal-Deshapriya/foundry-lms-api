import * as classroomRepo from "../../../repositories/v1/learning/classroom.repository.js";
import { toPublicCourseCard } from "../../../models/v1/catalog/catalog.model.js";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
} from "../../../constants/v1/audit/audit.constants.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import {
  assertCohortService,
  assertSelfPacedService,
} from "../catalog/learningServicePolicy.service.js";

const ACCESSIBLE_ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED"];
const ACCESSIBLE_BATCH_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"];

function isAdmin(role) {
  return [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role);
}

export async function requireEnrollmentAccessService(
  enrollmentId,
  requester,
  { adminsAllowed = true } = {},
) {
  const enrollment = await classroomRepo.findEnrollmentContext(enrollmentId);
  if (!enrollment) throw new NotFoundError("Enrollment not found.");
  if (
    enrollment.userId !== requester.id &&
    !(adminsAllowed && isAdmin(requester.role))
  ) {
    throw new ForbiddenError("You do not have access to this enrollment.");
  }
  if (!enrollment.user.emailVerified) {
    throw new ForbiddenError("The student account must be verified.");
  }
  if (!ACCESSIBLE_ENROLLMENT_STATUSES.includes(enrollment.status)) {
    throw new ForbiddenError("This enrollment does not have classroom access.");
  }

  const serviceType = enrollment.course.category.serviceType;
  if (enrollment.batchId) {
    assertCohortService(serviceType);
    if (enrollment.source !== "ADMIN") {
      throw new ConflictError("Invalid cohort enrollment configuration.");
    }
    if (enrollment.paymentStatus !== "COMPLETED") {
      throw new ForbiddenError("Payment must be completed before classroom access.");
    }
    if (!ACCESSIBLE_BATCH_STATUSES.includes(enrollment.batch?.status)) {
      throw new ForbiddenError("This batch is not currently accessible.");
    }
    return { enrollment, deliveryMode: "COHORT" };
  }

  assertSelfPacedService(serviceType);
  if (
    enrollment.source !== "SELF" ||
    enrollment.paymentStatus !== "NOT_REQUIRED"
  ) {
    throw new ConflictError("Invalid self-paced enrollment configuration.");
  }
  return { enrollment, deliveryMode: "SELF_PACED" };
}

async function visibleSessions(context) {
  if (context.deliveryMode === "COHORT") {
    const rows = await classroomRepo.findPaidSessions(
      context.enrollment.batchId,
      context.enrollment.id,
    );
    return rows.map((row) => ({
      courseSession: row.courseSession,
      deliveryOrder: row.orderIndex,
      releasedAt: row.updatedAt,
      availableAt: row.availableAt,
    }));
  }
  const rows = await classroomRepo.findFreeSessions(
    context.enrollment.courseId,
    context.enrollment.id,
  );
  return rows.map((courseSession) => ({
    courseSession,
    deliveryOrder: courseSession.orderIndex,
    releasedAt: null,
    availableAt: null,
  }));
}

function toSessionResponse(row) {
  const { courseSession } = row;
  const completion = courseSession.completions?.[0] ?? null;
  return {
    courseSessionId: courseSession.id,
    orderIndex: row.deliveryOrder,
    title: courseSession.session.title,
    description: courseSession.session.description,
    recordingUrl: courseSession.session.recordingUrl,
    materialUrl: courseSession.session.materialUrl,
    quizUrl: courseSession.session.quizUrl,
    feedbackUrl: courseSession.session.feedbackUrl,
    durationMinutes: courseSession.session.durationMinutes,
    sessionStatus: courseSession.session.status,
    availableAt: row.availableAt,
    completed: Boolean(completion),
    completedAt: completion?.completedAt ?? null,
  };
}

function progressFromRows(enrollmentId, courseId, rows) {
  const completedCount = rows.filter(
    ({ courseSession }) => courseSession.completions?.length > 0,
  ).length;
  const availableSessionCount = rows.length;
  return {
    enrollmentId,
    courseId,
    completedCount,
    availableSessionCount,
    progressPercent:
      availableSessionCount > 0
        ? Math.round((completedCount / availableSessionCount) * 100)
        : 0,
  };
}

export async function getClassroomService(enrollmentId, requester) {
  const context = await requireEnrollmentAccessService(enrollmentId, requester);
  const rows = await visibleSessions(context);
  return {
    enrollment: {
      id: context.enrollment.id,
      status: context.enrollment.status,
      source: context.enrollment.source,
      deliveryMode: context.deliveryMode,
      course: toPublicCourseCard(context.enrollment.course),
      batch: context.enrollment.batch
        ? {
            id: context.enrollment.batch.id,
            name: context.enrollment.batch.name,
            code: context.enrollment.batch.code,
            status: context.enrollment.batch.status,
            startDate: context.enrollment.batch.startDate,
            expectedEndDate: context.enrollment.batch.expectedEndDate,
            timezone: context.enrollment.batch.timezone,
          }
        : null,
    },
    sessions: rows.map(toSessionResponse),
    progress: progressFromRows(
      context.enrollment.id,
      context.enrollment.courseId,
      rows,
    ),
  };
}

async function requireVisibleSession(enrollmentId, courseSessionId, requester) {
  const context = await requireEnrollmentAccessService(enrollmentId, requester);
  const rows = await visibleSessions(context);
  const row = rows.find(
    ({ courseSession }) => courseSession.id === courseSessionId,
  );
  if (!row) {
    throw new NotFoundError("This session is not available in the enrollment classroom.");
  }
  return { context, row };
}

export async function getClassroomSessionService(
  enrollmentId,
  courseSessionId,
  requester,
) {
  const { row } = await requireVisibleSession(
    enrollmentId,
    courseSessionId,
    requester,
  );
  return toSessionResponse(row);
}

export async function completeClassroomSessionService(
  enrollmentId,
  courseSessionId,
  requester,
) {
  const { context, row } = await requireVisibleSession(
    enrollmentId,
    courseSessionId,
    requester,
  );
  const existing = row.courseSession.completions?.[0] ?? null;
  if (existing) return { ...existing, created: false };

  let completion;
  try {
    completion = await classroomRepo.createCompletion(
      enrollmentId,
      courseSessionId,
      context.enrollment.courseId,
    );
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    completion = await classroomRepo.findCompletion(enrollmentId, courseSessionId);
    if (!completion) throw error;
    return { ...completion, created: false };
  }
  recordActionService({
    actorUserId: requester.id,
    action: AUDIT_ACTIONS.SESSION_COMPLETED,
    entityType: ENTITY_TYPES.COURSE_SESSION,
    entityId: courseSessionId,
    description: `Session completed for enrollment ${enrollmentId}.`,
    metadata: { enrollmentId, courseId: context.enrollment.courseId },
  });
  return { ...completion, created: true };
}

export async function uncompleteClassroomSessionService(
  enrollmentId,
  courseSessionId,
  requester,
) {
  const { context } = await requireVisibleSession(
    enrollmentId,
    courseSessionId,
    requester,
  );
  const result = await classroomRepo.removeCompletion(
    enrollmentId,
    courseSessionId,
  );
  if (result.count > 0) {
    recordActionService({
      actorUserId: requester.id,
      action: AUDIT_ACTIONS.SESSION_COMPLETION_REMOVED,
      entityType: ENTITY_TYPES.COURSE_SESSION,
      entityId: courseSessionId,
      description: `Session completion removed for enrollment ${enrollmentId}.`,
      metadata: { enrollmentId, courseId: context.enrollment.courseId },
    });
  }
  return { success: true, removed: result.count > 0 };
}

export async function getProgressService(enrollmentId, requester) {
  const context = await requireEnrollmentAccessService(enrollmentId, requester);
  const rows = await visibleSessions(context);
  return progressFromRows(
    context.enrollment.id,
    context.enrollment.courseId,
    rows,
  );
}
