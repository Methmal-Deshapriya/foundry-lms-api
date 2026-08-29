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

export function toMyEnrollmentResponse(enrollment) {
  if (!enrollment) return null;
  const publicCourse = enrollment.course ? toPublicCourseCard(enrollment.course) : null;
  return {
    ...commonFields(enrollment),
    course: publicCourse
      ? {
          ...publicCourse,
          intakeKey: enrollment.course.intakeKey,
          code: enrollment.course.code,
          instanceKind: publicCourse.instanceKind,
          startDate: enrollment.course.startDate,
          expectedEndDate: enrollment.course.expectedEndDate,
          timezone: enrollment.course.timezone,
          courseStatus: enrollment.course.status,
        }
      : null,
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
    course: enrollment.course
      ? {
          ...toPublicCourseCard(enrollment.course),
          intakeKey: enrollment.course.intakeKey,
          code: enrollment.course.code,
          instanceKind: enrollment.course.category?.service?.courseMode,
          startDate: enrollment.course.startDate,
          expectedEndDate: enrollment.course.expectedEndDate,
          timezone: enrollment.course.timezone,
          courseStatus: enrollment.course.status,
        }
      : null,
  };
}

export const toMyEnrollmentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toMyEnrollmentResponse) : [];

export const toAdminEnrollmentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toAdminEnrollmentResponse) : [];

// Compatibility alias for course-wide admin roster consumers.
export const toCourseStudentListResponse = toAdminEnrollmentListResponse;
