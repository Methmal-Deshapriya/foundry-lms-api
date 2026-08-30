import { toPublicCourseCard } from "../catalog/catalog.model.js";
import { toAdminUserResponse } from "../users/user.model.js";

function toCertificateSummary(certificate) {
  if (!certificate) return null;
  return {
    id: certificate.id,
    certificateCode: certificate.certificateCode,
    status: certificate.status,
    issuedDate: certificate.issuedDate,
  };
}

function commonFields(enrollment) {
  const currentCertificate = enrollment.certificates?.[0] ?? null;
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    intakeId: enrollment.intakeId,
    source: enrollment.source,
    status: enrollment.status,
    paymentStatus: enrollment.paymentStatus,
    paymentCompletedAt: enrollment.paymentCompletedAt,
    completedAt: enrollment.completedAt,
    enrolledAt: enrollment.createdAt,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
    certificate: toCertificateSummary(currentCertificate),
  };
}

// The program (title, summary, price, ...) comes from Course; the specific
// run's own facts (code, dates, timezone, lifecycle status) come from
// Intake. See the 2026-08-30 rename plan §6 — Enrollment carries both.
function toEnrollmentCourseSummary(enrollment) {
  if (!enrollment.course) return null;
  const publicCourse = toPublicCourseCard(enrollment.course);
  const intake = enrollment.intake;
  return {
    ...publicCourse,
    intakeId: enrollment.intakeId,
    intakeKey: intake?.intakeKey,
    code: intake?.code,
    startDate: intake?.startDate,
    expectedEndDate: intake?.expectedEndDate,
    timezone: intake?.timezone,
    intakeStatus: intake?.status,
  };
}

export function toMyEnrollmentResponse(enrollment) {
  if (!enrollment) return null;
  return {
    ...commonFields(enrollment),
    course: toEnrollmentCourseSummary(enrollment),
  };
}

export function toAdminEnrollmentResponse(enrollment) {
  if (!enrollment) return null;
  return {
    ...commonFields(enrollment),
    externalPaymentReference: enrollment.externalPaymentReference,
    paymentNote: enrollment.paymentNote,
    enrolledByUserId: enrollment.enrolledByUserId,
    user: enrollment.user ? toAdminUserResponse(enrollment.user) : null,
    enrolledBy: enrollment.enrolledBy
      ? toAdminUserResponse(enrollment.enrolledBy)
      : null,
    course: toEnrollmentCourseSummary(enrollment),
  };
}

export const toMyEnrollmentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toMyEnrollmentResponse) : [];

export const toAdminEnrollmentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toAdminEnrollmentResponse) : [];

// Compatibility alias for intake-wide admin roster consumers.
export const toCourseStudentListResponse = toAdminEnrollmentListResponse;
