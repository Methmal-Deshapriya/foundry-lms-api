import * as classroomRepo from "../../../repositories/v1/learning/classroom.repository.js";
import { toPublicCourseCard } from "../../../models/v1/catalog/catalog.model.js";
import { toCertificateSummary } from "../../../models/v1/enrollments/enrollment.model.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { PERMISSIONS, hasPermission, isLearnerRole } from "../../../constants/v1/auth/permissions.constants.js";
import {
  ConflictError,
  EnrollmentCompletedError,
  ForbiddenError,
  NotFoundError,
} from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { hasLearningAccess, hasSufficientPayment } from "../../../utils/enrollmentAccessPolicy.js";
import { privateStoredObjectUrl } from "../storage/storedObject.service.js";
import { publicObjectUrl } from "../../../config/r2.js";

const ACCESSIBLE_ENROLLMENT_STATUSES = ["ACTIVE", "COMPLETED"];
const ACCESSIBLE_INTAKE_STATUSES = [
  "OPEN_ACTIVE",
  "CLOSED_ACTIVE",
  "COMPLETED",
  "ARCHIVED",
];

// Staff who may open any student's classroom: whoever manages enrollments.
function canOpenAnyClassroom(role) {
  return hasPermission(role, PERMISSIONS.ENROLLMENTS_MANAGE);
}

// Students who finished an intake keep their classroom (recordings and
// materials) even if the intake is cancelled afterwards; everyone else loses
// access when it is cancelled (owner decision 2026-10-01, code review M07-09).
function intakeAllowsAccess(intakeStatus, enrollmentStatus) {
  if (ACCESSIBLE_INTAKE_STATUSES.includes(intakeStatus)) return true;
  return intakeStatus === "CANCELLED" && enrollmentStatus === "COMPLETED";
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
    !(adminsAllowed && canOpenAnyClassroom(requester.role))
  ) {
    throw new ForbiddenError("You do not have access to this enrollment.");
  }
  if (!enrollment.user.emailVerified) {
    throw new ForbiddenError("The student account must be verified.");
  }
  if (!ACCESSIBLE_ENROLLMENT_STATUSES.includes(enrollment.status)) {
    throw new ForbiddenError("This enrollment does not have classroom access.");
  }
  if (!intakeAllowsAccess(enrollment.intake.status, enrollment.status)) {
    throw new ForbiddenError("This course is not currently accessible.");
  }

  const policy = enrollment.intake.service;
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

// Uploaded recordings and materials are not signed into the session list:
// a signed link expires minutes after the page loads (code review M07-01).
// The list points at an API address instead, which re-checks access and
// redirects to a freshly signed link on every click (getSessionFileService).
const isReadyFile = (object) => object?.status === "READY" && object.scope === "PRIVATE";
const sessionFilePath = (enrollmentId, courseSessionId, kind) =>
  `/api/v1/enrollments/${enrollmentId}/sessions/${courseSessionId}/${kind}`;

async function toSessionResponse(courseSession, enrollmentId) {
  const completion = courseSession.completions?.[0] ?? null;
  const recordingObjectUrl = isReadyFile(courseSession.session.recordingObject)
    ? sessionFilePath(enrollmentId, courseSession.id, "recording")
    : null;
  const materialObjectUrl = isReadyFile(courseSession.session.materialObject)
    ? sessionFilePath(enrollmentId, courseSession.id, "material")
    : null;
  return {
    courseSessionId: courseSession.id,
    orderIndex: courseSession.orderIndex ?? courseSession.historicalOrderIndex,
    title: courseSession.session.title,
    description: courseSession.session.description,
    recordingUrl: recordingObjectUrl ?? courseSession.session.recordingUrl,
    materialUrl: materialObjectUrl ?? courseSession.session.materialUrl,
    quizUrl: courseSession.session.quizUrl,
    feedbackUrl: courseSession.session.feedbackUrl,
    durationMinutes: courseSession.session.durationMinutes,
    sessionStatus: courseSession.session.status,
    deliveryStatus: courseSession.deliveryStatus,
    availableAt: courseSession.availableAt,
    retired: Boolean(courseSession.retiredAt),
    // True when recordingUrl/materialUrl is an API path (prefix it with the
    // API origin) rather than an external link.
    recordingIsFile: Boolean(recordingObjectUrl),
    materialIsFile: Boolean(materialObjectUrl),
    completed: Boolean(completion),
    completedAt: completion?.completedAt ?? null,
  };
}

function progressFromRows(enrollmentId, courseId, intakeId, rows, enrollmentStatus) {
  const availableSessionCount = rows.length;
  // A completed enrollment is 100%, even if sessions are released after it
  // was completed — its completions are frozen (code review M07-10).
  const completedCount = enrollmentStatus === "COMPLETED"
    ? availableSessionCount
    : rows.filter(({ completions }) => completions?.length > 0).length;
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
        thumbnailUrl:
          course.thumbnailObject?.status === "READY"
            ? publicObjectUrl(course.thumbnailObject.objectKey)
            : course.thumbnailUrl,
        serviceTitle: intake.service.title,
        intakeKey: intake.intakeKey,
        code: intake.code,
        instanceKind: intake.service.courseMode,
        startDate: intake.startDate,
        expectedEndDate: intake.expectedEndDate,
        timezone: intake.timezone,
      },
    },
    sessions: await Promise.all(rows.map((row) => toSessionResponse(row, enrollment.id))),
    progress: progressFromRows(
      enrollment.id,
      enrollment.courseId,
      enrollment.intakeId,
      rows,
      enrollment.status,
    ),
  };
}

async function requireVisibleSession(
  enrollmentId,
  courseSessionId,
  requester,
  { completionMutation = false } = {},
) {
  if (completionMutation && !isLearnerRole(requester.role)) {
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
  return toSessionResponse(row, enrollmentId);
}

// Recordings stream for hours (seeking re-fetches byte ranges), so their
// link lives longer than a one-off material download.
const RECORDING_LINK_SECONDS = 4 * 60 * 60;

/**
 * A fresh signed link to a session's uploaded recording or material, after
 * the same access and visibility checks as the classroom itself. Recordings
 * open inline (play in the browser); materials download (M07-01/M07-07).
 */
export async function getSessionFileService(enrollmentId, courseSessionId, kind, requester) {
  if (!["recording", "material"].includes(kind)) throw new NotFoundError("File not found.");
  const { row } = await requireVisibleSession(enrollmentId, courseSessionId, requester);
  const object = kind === "recording" ? row.session.recordingObject : row.session.materialObject;
  const url = await privateStoredObjectUrl(object, kind === "recording" ? { inline: true, expiresIn: RECORDING_LINK_SECONDS } : {});
  if (!url) throw new NotFoundError("This session has no uploaded file of that kind.");
  return url;
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
  return progressFromRows(context.enrollment.id, context.enrollment.courseId, context.enrollment.intakeId, rows, context.enrollment.status);
}
