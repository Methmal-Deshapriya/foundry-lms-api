import * as repository from "../../../repositories/v1/enrollments/enrollmentRequest.repository.js";
import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import * as userRepository from "../../../repositories/v1/users/user.repository.js";
import { enrollStudentInCourseService } from "./enrollment.service.js";
import {
  createEnrollmentRequestSchema,
  enrollFromRequestSchema,
  enrollmentRequestFiltersSchema,
  enrollmentRequestStatusSchema,
} from "../../../constants/v1/enrollments/enrollmentRequest.schema.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { sendEnrollmentRequestNotificationEmail } from "../../../utils/email.js";
import prisma from "../../../utils/prisma.js";

// PENDING is reachable only from DECLINED — reopening a declined request
// rather than forcing the student to resubmit (Q2 of the 2026-08-30 system
// guide/audit). ENROLLED is terminal and reached only through the dedicated
// /enroll endpoint, never through this status transition.
const ALLOWED_TRANSITIONS = Object.freeze({
  PENDING: ["CONTACTED", "DECLINED"],
  CONTACTED: ["DECLINED"],
  DECLINED: ["PENDING"],
  ENROLLED: [],
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) { const issue = result.error.issues[0]; throw new ValidationError(issue.message, issue.path[0]); }
  return result.data;
}

function toResponse(request) {
  if (!request) return null;
  return {
    id: request.id,
    courseId: request.courseId,
    intakeId: request.intakeId,
    status: request.status,
    contactPhone: request.contactPhone,
    contactedAt: request.contactedAt,
    enrollmentId: request.enrollmentId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    course: request.course ? { id: request.course.id, title: request.course.title, slug: request.course.slug } : null,
    intake: request.intake ? { id: request.intake.id, code: request.intake.code, status: request.intake.status } : null,
    student: request.student
      ? { id: request.student.id, firstName: request.student.firstName, lastName: request.student.lastName, email: request.student.email, phone: request.student.phone }
      : null,
    contactedBy: request.contactedBy
      ? { id: request.contactedBy.id, firstName: request.contactedBy.firstName, lastName: request.contactedBy.lastName }
      : null,
  };
}

function toStatusSummary(statusCounts) {
  const counts = { PENDING: 0, CONTACTED: 0, ENROLLED: 0, DECLINED: 0 };
  for (const row of statusCounts) counts[row.status] = row._count;
  return { all: Object.values(counts).reduce((sum, n) => sum + n, 0), ...counts };
}

export async function createEnrollmentRequestService(courseId, data, student) {
  const input = parse(createEnrollmentRequestSchema, data);
  const request = await repository.create(courseId, student.id, input.contactPhone);

  recordActionService({
    actorUserId: student.id,
    action: AUDIT_ACTIONS.ENROLLMENT_REQUEST_CREATED,
    entityType: ENTITY_TYPES.ENROLLMENT_REQUEST,
    entityId: request.id,
    description: `${student.email} requested to enroll in "${request.course.title}".`,
    metadata: { courseId, intakeId: request.intakeId },
  });

  // Notification is best-effort — a slow/failed SMTP send should never fail
  // the student's request itself.
  notifyAdminsOfEnrollmentRequest(request).catch(() => {});

  return toResponse(request);
}

async function notifyAdminsOfEnrollmentRequest(request) {
  const admins = await userRepository.findAdminEmails();
  if (admins.length === 0) return;
  const clientUrl = process.env.CLIENT_URL?.replace(/\/$/, "") ?? "";
  // Must match the live admin route exactly — see Finding A of the
  // 2026-08-30 system guide/audit (the previous /admin/catalog/courses/...
  // link pointed at a route that doesn't exist).
  const requestUrl = `${clientUrl}/admin/services/${request.course.category.service.slug}/categories/${request.course.categoryId}/courses/${request.courseId}/intakes/${request.intakeId}?tab=enrollment-requests&requestId=${request.id}`;
  await Promise.all(
    admins.map((email) =>
      sendEnrollmentRequestNotificationEmail(email, {
        courseTitle: request.course.title,
        intakeCode: request.intake.code,
        studentName: `${request.student.firstName} ${request.student.lastName}`.trim(),
        requestUrl,
      }),
    ),
  );
}

export async function listEnrollmentRequestsForIntakeService(intakeId, query) {
  if (!(await intakeRepository.findById(intakeId))) throw new NotFoundError("Intake not found.");
  const { limit, offset, ...filters } = parse(enrollmentRequestFiltersSchema, query);
  const { total, statusCounts, requests } = await repository.findForIntake(intakeId, { ...filters, limit, offset });
  return {
    requests: requests.map(toResponse),
    summary: toStatusSummary(statusCounts),
    pagination: { total, limit, offset, hasMore: offset + requests.length < total },
  };
}

export async function getEnrollmentRequestAdminService(id) {
  const request = await repository.findById(id);
  if (!request) throw new NotFoundError("Enrollment request not found.");
  return toResponse(request);
}

const STATUS_AUDIT_ACTIONS = Object.freeze({
  CONTACTED: AUDIT_ACTIONS.ENROLLMENT_REQUEST_CONTACTED,
  DECLINED: AUDIT_ACTIONS.ENROLLMENT_REQUEST_DECLINED,
  PENDING: AUDIT_ACTIONS.ENROLLMENT_REQUEST_REOPENED,
});

export async function updateEnrollmentRequestStatusService(id, data, actorId) {
  const { status } = parse(enrollmentRequestStatusSchema, data);
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Enrollment request not found.");
  if (!ALLOWED_TRANSITIONS[current.status]?.includes(status)) {
    throw new ConflictError(`Enrollment request cannot move from ${current.status} to ${status}.`, "INVALID_ENROLLMENT_REQUEST_TRANSITION");
  }
  const request = await repository.updateStatus(id, current.status, status, actorId);
  recordActionService({
    actorUserId: actorId,
    action: STATUS_AUDIT_ACTIONS[status],
    entityType: ENTITY_TYPES.ENROLLMENT_REQUEST,
    entityId: id,
    description: `Enrollment request ${id} marked ${status}.`,
    metadata: { courseId: current.courseId, intakeId: current.intakeId },
  });
  return toResponse(request);
}

/**
 * Converts a request into a real Enrollment + Payment, via the same shared
 * enroll mutation the Enrollments tab's direct search-and-enroll flow uses —
 * see the 2026-08-30 rename plan §8a. Not a second implementation of the
 * enroll rules.
 */
export async function enrollFromRequestService(id, data, actorId) {
  const input = parse(enrollFromRequestSchema, data);
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Enrollment request not found.");
  if (!["PENDING", "CONTACTED"].includes(current.status)) throw new ConflictError(`Enrollment request cannot move from ${current.status}.`, "INVALID_ENROLLMENT_REQUEST_TRANSITION");

  // The intake resolved when this request was filed can go stale — closed,
  // or superseded by a new one — while it sat waiting on admin follow-up.
  // Re-resolve to the course's *current* open intake at conversion time
  // instead of failing on the original. See Finding I of the 2026-08-30
  // system guide/audit.
  let targetIntakeId = current.intakeId;
  const retargeted = current.intake.status !== "OPEN_ACTIVE";
  if (retargeted) {
    targetIntakeId = await courseRepository.findCurrentOpenIntakeId(current.courseId);
    if (!targetIntakeId) {
      throw new ConflictError(
        "This course is not currently enrolling. Ask the student to submit a new request.",
        "COURSE_NOT_ENROLLING",
      );
    }
    await repository.retarget(id, targetIntakeId);
  }

  const enrollment = await enrollStudentInCourseService(targetIntakeId, { userId: current.studentUserId, ...input }, actorId);

  const request = await prisma.$transaction((transaction) => repository.markEnrolled(transaction, id, enrollment.id));
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.ENROLLMENT_REQUEST_ENROLLED,
    entityType: ENTITY_TYPES.ENROLLMENT_REQUEST,
    entityId: id,
    description: `Enrollment request ${id} converted to enrollment ${enrollment.id}.`,
    metadata: { courseId: current.courseId, intakeId: targetIntakeId, enrollmentId: enrollment.id, retargeted },
  });
  return { request: toResponse(request), enrollment };
}
