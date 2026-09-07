import * as classroomRepo from "../../../repositories/v1/learning/classroom.repository.js";
import { toPublicCourseCard } from "../../../models/v1/catalog/catalog.model.js";
import { toCertificateSummary } from "../../../models/v1/enrollments/enrollment.model.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import {
  ConflictError,
  EnrollmentCompletedError,
  ForbiddenError,
  NotFoundError,
} from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { hasLearningAccess, hasSufficientPayment } from "../../../utils/enrollmentAccessPolicy.js";

const ACCESSIBLE_ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED"];
const ACCESSIBLE_INTAKE_STATUSES = [
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
  if (!ACCESSIBLE_INTAKE_STATUSES.includes(enrollment.intake.status)) {
    throw new ForbiddenError("This course is not currently accessible.");
  }

  const policy = enrollment.intake.category.service;
  if (!hasLearningAccess(enrollment, policy)) {
    if (policy.accessType !== "FREE" && !hasSufficientPayment(enrollment.paymentStatus)) {
      throw new ForbiddenError("Payment must be recorded before classroom access.");
    }
    throw new ConflictError("Invalid enrollment access configuration.");
  }

  return { enrollment, deliveryMode: policy.accessType === "FREE" ? "FREE" : "PAID" };
}

async function visibleSessions(context) {
  return classroomRepo.findVisibleSessions(
    context.enrollment.intakeId,
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

function progressFromRows(enrollmentId, courseId, intakeId, rows) {
  const completedCount = rows.filter(
    ({ completions }) => completions?.length > 0,
  ).length;
  const availableSessionCount = rows.length;
  return {
    enrollmentId,
    courseId,
    intakeId,
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
  const { enrollment } = context;
  const { course, intake } = enrollment;
  return {
    enrollment: {
      id: enrollment.id,
      status: enrollment.status,
      source: enrollment.source,
      deliveryMode: context.deliveryMode,
      enrolledAt: enrollment.createdAt,
      paymentStatus: enrollment.paymentStatus,
      paymentCompletedAt: enrollment.paymentCompletedAt,
      certificate: toCertificateSummary(enrollment.certificates?.[0] ?? null),
      course: {
        ...toPublicCourseCard(course),
        description: course.description,
        highlights: course.highlights,
        skills: course.skills,
        prerequisites: course.prerequisites,
        thumbnailUrl: course.thumbnailUrl,
        categoryTitle: intake.category.title,
        categoryVisualKey: intake.category.visualKey,
        serviceTitle: intake.category.service.title,
        intakeKey: intake.intakeKey,
        code: intake.code,
        instanceKind: intake.category.service.courseMode,
        startDate: intake.startDate,
        expectedEndDate: intake.expectedEndDate,
        timezone: intake.timezone,
      },
    },
    sessions: rows.map(toSessionResponse),
    progress: progressFromRows(
      enrollment.id,
      enrollment.courseId,
      enrollment.intakeId,
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
      context.enrollment.intakeId,
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
    metadata: { enrollmentId, intakeId: context.enrollment.intakeId },
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
    context.enrollment.intakeId,
  );
  if (result.count > 0) {
    recordActionService({
      actorUserId: requester.id,
      action: AUDIT_ACTIONS.SESSION_COMPLETION_REMOVED,
      entityType: ENTITY_TYPES.COURSE_SESSION,
      entityId: courseSessionId,
      description: `Session completion removed for enrollment ${enrollmentId}.`,
      metadata: { enrollmentId, intakeId: context.enrollment.intakeId },
    });
  }
  return { success: true, removed: result.count > 0 };
}

export async function getProgressService(enrollmentId, requester) {
  const context = await requireEnrollmentAccessService(enrollmentId, requester);
  const rows = await visibleSessions(context);
  return progressFromRows(context.enrollment.id, context.enrollment.courseId, context.enrollment.intakeId, rows);
}
