import * as classroomRepo from "../../../repositories/v1/learning/classroom.repository.js";
import { toPublicCourseCard } from "../../../models/v1/catalog/catalog.model.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import {
  ConflictError,
  EnrollmentCompletedError,
  ForbiddenError,
  NotFoundError,
} from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";

const ACCESSIBLE_ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED"];
const ACCESSIBLE_COURSE_STATUSES = [
  "OPEN_ACTIVE",
  "CLOSED_ACTIVE",
  "COMPLETED",
  "ARCHIVED",
];

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
  if (!ACCESSIBLE_COURSE_STATUSES.includes(enrollment.course.status)) {
    throw new ForbiddenError("This course is not currently accessible.");
  }

  const policy = enrollment.course.category.service;
  const isFree = policy.accessType === "FREE";
  const accessIsValid = isFree
    ? policy.enrollmentMode === "SELF" && policy.paymentRequirement === "NOT_REQUIRED" && enrollment.source === "SELF" && enrollment.paymentStatus === "NOT_REQUIRED"
    : policy.enrollmentMode === "ADMIN" && policy.paymentRequirement === "REQUIRED" && enrollment.source === "ADMIN" && enrollment.paymentStatus === "COMPLETED";
  if (!accessIsValid) {
    if (!isFree && enrollment.paymentStatus !== "COMPLETED") {
      throw new ForbiddenError("Payment must be completed before classroom access.");
    }
    throw new ConflictError("Invalid enrollment access configuration.");
  }

  return { enrollment, deliveryMode: isFree ? "FREE" : "PAID" };
}

async function visibleSessions(context) {
  return classroomRepo.findVisibleSessions(
    context.enrollment.courseId,
    context.enrollment.id,
  );
}

function toSessionResponse(courseSession) {
  const completion = courseSession.completions?.[0] ?? null;
  return {
    courseSessionId: courseSession.id,
    orderIndex: courseSession.orderIndex ?? courseSession.historicalOrderIndex,
    title: courseSession.session.title,
    description: courseSession.session.description,
    recordingUrl: courseSession.session.recordingUrl,
    materialUrl: courseSession.session.materialUrl,
    quizUrl: courseSession.session.quizUrl,
    feedbackUrl: courseSession.session.feedbackUrl,
    durationMinutes: courseSession.session.durationMinutes,
    sessionStatus: courseSession.session.status,
    deliveryStatus: courseSession.deliveryStatus,
    availableAt: courseSession.availableAt,
    retired: Boolean(courseSession.retiredAt),
    completed: Boolean(completion),
    completedAt: completion?.completedAt ?? null,
  };
}

function progressFromRows(enrollmentId, courseId, rows) {
  const completedCount = rows.filter(
    ({ completions }) => completions?.length > 0,
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
      course: {
        ...toPublicCourseCard(context.enrollment.course),
        intakeKey: context.enrollment.course.intakeKey,
        code: context.enrollment.course.code,
        instanceKind: context.enrollment.course.category.service.courseMode,
      },
    },
    sessions: rows.map(toSessionResponse),
    progress: progressFromRows(
      context.enrollment.id,
      context.enrollment.courseId,
      rows,
    ),
  };
}

async function requireVisibleSession(
  enrollmentId,
  courseSessionId,
  requester,
  { completionMutation = false } = {},
) {
  if (completionMutation && requester.role !== ROLES.STUDENT) {
    throw new ForbiddenError("Only students can change session completion.");
  }
  const context = await requireEnrollmentAccessService(enrollmentId, requester, {
    adminsAllowed: !completionMutation,
  });
  if (completionMutation && context.enrollment.status === "COMPLETED") {
    throw new EnrollmentCompletedError();
  }
  const rows = await visibleSessions(context);
  const row = rows.find(({ id }) => id === courseSessionId);
  if (!row) {
    throw new NotFoundError("This session is not available in the enrollment classroom.");
  }
  return { context, row };
}

export async function getClassroomSessionService(enrollmentId, courseSessionId, requester) {
  const { row } = await requireVisibleSession(enrollmentId, courseSessionId, requester);
  return toSessionResponse(row);
}

export async function completeClassroomSessionService(enrollmentId, courseSessionId, requester) {
  const { context, row } = await requireVisibleSession(
    enrollmentId,
    courseSessionId,
    requester,
    { completionMutation: true },
  );
  const existing = row.completions?.[0] ?? null;
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

export async function uncompleteClassroomSessionService(enrollmentId, courseSessionId, requester) {
  const { context } = await requireVisibleSession(
    enrollmentId,
    courseSessionId,
    requester,
    { completionMutation: true },
  );
  const result = await classroomRepo.removeCompletion(
    enrollmentId,
    courseSessionId,
    context.enrollment.courseId,
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
  return progressFromRows(context.enrollment.id, context.enrollment.courseId, rows);
}
