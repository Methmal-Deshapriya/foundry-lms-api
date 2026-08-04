import { toPublicCourseCard } from "../catalog/catalog.model.js";
import { toAdminUserResponse } from "../users/user.model.js";

export function toMyEnrollmentResponse(enrollment) {
  if (!enrollment) return null;
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    status: enrollment.status,
    paymentStatus: enrollment.paymentStatus,
    paymentCompletedAt: enrollment.paymentCompletedAt,
    completedAt: enrollment.completedAt,
    enrolledAt: enrollment.createdAt,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
    course: enrollment.course ? toPublicCourseCard(enrollment.course) : null,
  };
}

export function toCourseStudentResponse(enrollment) {
  if (!enrollment) return null;
  return {
    id: enrollment.id,
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    status: enrollment.status,
    paymentStatus: enrollment.paymentStatus,
    paymentCompletedAt: enrollment.paymentCompletedAt,
    completedAt: enrollment.completedAt,
    enrolledAt: enrollment.createdAt,
    createdAt: enrollment.createdAt,
    updatedAt: enrollment.updatedAt,
    user: enrollment.user ? toAdminUserResponse(enrollment.user) : null,
  };
}

export const toMyEnrollmentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toMyEnrollmentResponse) : [];

export const toCourseStudentListResponse = (enrollments) =>
  Array.isArray(enrollments) ? enrollments.map(toCourseStudentResponse) : [];
