import { toPublicCourseCard } from "../catalog/catalog.model.js";
import { toAdminUserResponse } from "../users/user.model.js";

function toBatchSummary(batch) {
  if (!batch) return null;
  return {
    id: batch.id,
    name: batch.name,
    code: batch.code,
    startDate: batch.startDate,
    expectedEndDate: batch.expectedEndDate,
    timezone: batch.timezone,
    status: batch.status,
  };
}

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
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    batchId: enrollment.batchId,
    source: enrollment.source,
    status: enrollment.status,
    paymentStatus: enrollment.paymentStatus,
    paymentCompletedAt: enrollment.paymentCompletedAt,
    completedAt: enrollment.completedAt,
    enrolledAt: enrollment.createdAt,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
    batch: toBatchSummary(enrollment.batch),
    certificate: toCertificateSummary(enrollment.certificate),
  };
}

export function toMyEnrollmentResponse(enrollment) {
  if (!enrollment) return null;
  return {
    ...commonFields(enrollment),
    course: enrollment.course ? toPublicCourseCard(enrollment.course) : null,
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
    course: enrollment.course ? toPublicCourseCard(enrollment.course) : null,
  };
}

export const toMyEnrollmentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toMyEnrollmentResponse) : [];

export const toAdminEnrollmentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toAdminEnrollmentResponse) : [];

// Compatibility alias for course-wide admin roster consumers.
export const toCourseStudentListResponse = toAdminEnrollmentListResponse;
