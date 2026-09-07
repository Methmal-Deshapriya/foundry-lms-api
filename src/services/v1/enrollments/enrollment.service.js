import * as repository from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import * as userRepository from "../../../repositories/v1/users/user.repository.js";
import * as model from "../../../models/v1/enrollments/enrollment.model.js";
import {
  bulkManualEnrollmentSchema,
  eligibleStudentCursorPayloadSchema,
  eligibleStudentFiltersSchema,
  enrollmentRosterFiltersSchema,
  manualEnrollmentSchema,
  updateEnrollmentSchema,
} from "../../../constants/v1/enrollments/enrollment.schema.js";
import { selfHistoryPageSchema } from "../../../constants/v1/shared/pagination.schema.js";
import { ENROLLMENT_STATUS, ENROLLMENT_STATUS_TRANSITIONS } from "../../../constants/v1/enrollments/enrollment.constants.js";
import { CourseCapacityReachedError, ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";

function parse(schema, value) { const result = schema.safeParse(value); if (!result.success) { const issue = result.error.issues[0]; throw new ValidationError(issue.message, issue.path.join(".")); } return result.data; }
function assertStudent(user) { if (!user) throw new NotFoundError("Student not found."); if (user.role !== "STUDENT" || !user.emailVerified) throw new ConflictError("Only verified student accounts can be enrolled.", "INELIGIBLE_STUDENT"); }
function assertPaidOpen(intake) { if (!intake) throw new NotFoundError("Intake not found."); const policy = intake.category.service; if (intake.status !== "OPEN_ACTIVE" || policy.status !== "ACTIVE" || policy.accessType !== "PAID" || policy.courseMode !== "SEASONAL" || policy.enrollmentMode !== "ADMIN" || policy.paymentRequirement !== "REQUIRED") throw new ConflictError("This paid intake is not accepting enrollment.", "COURSE_ENROLLMENT_CLOSED"); }
function payment(input) { return { paymentStatus: input.paymentStatus, paymentCompletedAt: input.paymentStatus === "COMPLETED" ? new Date() : null, externalPaymentReference: input.externalPaymentReference ?? null, paymentNote: input.paymentNote ?? null }; }

export async function enrollStudentInCourseService(intakeId, data, actorId) {
  const input = parse(manualEnrollmentSchema, data);
  const [intake, student] = await Promise.all([intakeRepository.findById(intakeId), userRepository.findUserById(input.userId)]);
  assertPaidOpen(intake); assertStudent(student);
  const enrollment = await repository.createPaid(intakeId, input.userId, actorId, payment(input));
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.STUDENT_ENROLLED, entityType: ENTITY_TYPES.ENROLLMENT, entityId: enrollment.id, description: `Student ${student.email} enrolled in ${intake.code}.`, metadata: { studentId: student.id, intakeId, paymentStatus: enrollment.paymentStatus } });
  return model.toAdminEnrollmentResponse(enrollment);
}

export async function bulkEnrollStudentsInCourseService(intakeId, data, actorId) {
  const { students } = parse(bulkManualEnrollmentSchema, data);
  const intake = await intakeRepository.findById(intakeId); assertPaidOpen(intake);
  const users = await userRepository.findVerifiedStudentsByIds(students.map(({ userId }) => userId));
  const byId = new Map(users.map((user) => [user.id, user]));
  const results = [];
  for (let index = 0; index < students.length; index += 1) {
    const input = students[index]; const student = byId.get(input.userId);
    if (!student) { results.push({ userId: input.userId, status: "FAILED", code: "INELIGIBLE_STUDENT", error: "Student is missing, unverified, or not a Student." }); continue; }
    try {
      const enrollment = await repository.createPaid(intakeId, input.userId, actorId, payment(input));
      results.push({ userId: input.userId, status: "CREATED", enrollment: model.toAdminEnrollmentResponse(enrollment) });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      results.push({ userId: input.userId, status: "FAILED", code: error.code, error: error.message });
      if (error instanceof CourseCapacityReachedError) {
        for (const remaining of students.slice(index + 1)) results.push({ userId: remaining.userId, status: "FAILED", code: error.code, error: error.message });
        break;
      }
    }
  }
  const created = results.filter(({ status }) => status === "CREATED").length;
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.STUDENTS_BULK_ENROLLED, entityType: ENTITY_TYPES.INTAKE, entityId: intakeId, description: `${created} of ${students.length} students enrolled in ${intake.code}.`, metadata: { intakeId, requested: students.length, created } });
  return { results, summary: { requested: students.length, created, failed: students.length - created } };
}

export async function selfEnrollFreeCourseService(intakeId, user) {
  const [intake, student] = await Promise.all([intakeRepository.findPublishedFreeIntakeById(intakeId), userRepository.findUserById(user.id)]);
  if (!intake) throw new NotFoundError("This Free Learning course is not available for enrollment.");
  assertStudent(student);
  const { enrollment, outcome } = await repository.enrollFree(user.id, intakeId);
  if (outcome !== "EXISTING") recordActionService({ actorUserId: user.id, action: outcome === "REACTIVATED" ? AUDIT_ACTIONS.STUDENT_SELF_REENROLLED : AUDIT_ACTIONS.STUDENT_SELF_ENROLLED, entityType: ENTITY_TYPES.ENROLLMENT, entityId: enrollment.id, description: `${student.email} ${outcome.toLowerCase()} in "${intake.course.title}".`, metadata: { intakeId, outcome } });
  return { enrollment: model.toMyEnrollmentResponse(enrollment), created: outcome === "CREATED", reactivated: outcome === "REACTIVATED" };
}

export async function updateEnrollmentService(id, data, actorId) {
  const input = parse(updateEnrollmentSchema, data); const current = await repository.findById(id); if (!current) throw new NotFoundError("Enrollment not found.");
  if (current.source === "SELF" && ["externalPaymentReference", "paymentNote"].some((field) => Object.hasOwn(input, field))) throw new ConflictError("Free enrollment has no payment details.");
  if (current.source === "SELF" && current.status === "CANCELLED" && input.status && input.status !== "CANCELLED") throw new ConflictError("The student must reactivate free enrollment by self-enrolling.");
  if (input.status && input.status !== current.status && !(ENROLLMENT_STATUS_TRANSITIONS[current.status] ?? []).includes(input.status)) throw new ConflictError(`Enrollment cannot move from ${current.status} to ${input.status}.`);
  if (current.status === ENROLLMENT_STATUS.COMPLETED && input.status) throw new ConflictError("Completed enrollment is terminal.");
  const update = { ...input };
  if (input.status && input.status !== current.status) update.completedAt = input.status === "COMPLETED" ? new Date() : null;
  const result = await repository.update(id, { status: current.status, paymentStatus: current.paymentStatus }, update);
  recordActionService({ actorUserId: actorId, action: input.status === "COMPLETED" ? AUDIT_ACTIONS.ENROLLMENT_COMPLETED : AUDIT_ACTIONS.ENROLLMENT_STATUS_UPDATED, entityType: ENTITY_TYPES.ENROLLMENT, entityId: id, description: `Enrollment ${id} updated.`, metadata: { intakeId: current.intakeId, changedFields: Object.keys(input) } });
  return model.toAdminEnrollmentResponse(result);
}

// A PARTIAL enrollment pays the other half of the course price later, at
// which point it becomes fully paid — the only thing this can ever do,
// since there's no partial-to-partial or completed-to-partial transition.
export async function completePaymentService(id, actorId) {
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Enrollment not found.");
  if (current.paymentStatus !== "PARTIAL") throw new ConflictError("Only a partially paid enrollment can have its remaining payment recorded.", "PAYMENT_NOT_PARTIAL");
  const result = await repository.completePayment(id, actorId);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.PAYMENT_STATUS_UPDATED, entityType: ENTITY_TYPES.ENROLLMENT, entityId: id, description: `Remaining payment recorded for enrollment ${id}; payment is now complete.`, metadata: { intakeId: current.intakeId } });
  return model.toAdminEnrollmentResponse(result);
}

export async function getMyEnrollmentsService(userId, query = {}) {
  const filters = parse(selfHistoryPageSchema, query); const rows = await repository.findUserEnrollments(userId, filters); const hasMore = rows.length > filters.limit; const page = rows.slice(0, filters.limit);
  const progressByEnrollment = await repository.findProgressForEnrollments(page);
  return { enrollments: model.toMyEnrollmentListResponse(page, progressByEnrollment), pagination: { limit: filters.limit, hasMore, nextCursor: hasMore ? page.at(-1)?.id ?? null : null } };
}

function toEnrollmentStatusSummary(statusCounts) {
  const counts = { ACTIVE: 0, COMPLETED: 0, CANCELLED: 0 };
  for (const row of statusCounts) counts[row.status] = row._count;
  return { all: counts.ACTIVE + counts.COMPLETED + counts.CANCELLED, active: counts.ACTIVE, completed: counts.COMPLETED, cancelled: counts.CANCELLED };
}

export async function getCourseEnrollmentsService(intakeId, query = {}) {
  if (!(await intakeRepository.findById(intakeId))) throw new NotFoundError("Intake not found.");
  const filters = parse(enrollmentRosterFiltersSchema, query);
  const { enrollments, total, statusCounts } = await repository.findCourseEnrollments(intakeId, filters);
  return {
    enrollments: model.toAdminEnrollmentListResponse(enrollments),
    summary: toEnrollmentStatusSummary(statusCounts),
    pagination: { total, limit: filters.limit, offset: filters.offset, hasMore: filters.offset + enrollments.length < total },
  };
}

export async function getEligibleStudentsForCourseService(intakeId, query = {}) {
  const intake = await intakeRepository.findById(intakeId); assertPaidOpen(intake); const filters = parse(eligibleStudentFiltersSchema, query); let cursor = null;
  if (filters.cursor) { try { cursor = eligibleStudentCursorPayloadSchema.parse(JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8"))); if (cursor.intakeId !== intakeId || cursor.q !== filters.q) throw new Error(); } catch { throw new ValidationError("Invalid eligible-student cursor.", "cursor"); } }
  const rows = await repository.searchEligibleStudents(intakeId, filters.q, filters.limit, cursor); const hasMore = rows.length > filters.limit; const students = rows.slice(0, filters.limit); const last = students.at(-1);
  return { students, pagination: { limit: filters.limit, hasMore, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ intakeId, q: filters.q, email: last.email, id: last.id })).toString("base64url") : null } };
}

export const getCourseStudentsService = getCourseEnrollmentsService;
