import { toPublicBootcampResponse } from "../bootcamps/bootcamp.model.js";
import { toAdminUserResponse } from "../users/user.model.js";

/**
 * Enrollment Model - The "Relationship Mask"
 * Defines the shape of student-bootcamp connections.
 */

/**
 * Transform an enrollment record for the Student's "My Courses" view.
 * Includes details about the bootcamp itself.
 * 
 * @param {object} enrollment - The raw enrollment record with bootcamp included.
 * @returns {object} The sanitized enrollment with bootcamp details.
 */
export function toMyEnrollmentResponse(enrollment) {
  if (!enrollment) return null;

  return {
    id: enrollment.id,
    enrolledAt: enrollment.createdAt,
    // Flatten or include the bootcamp details using our existing bootcamp model
    bootcamp: enrollment.bootcamp ? toPublicBootcampResponse(enrollment.bootcamp) : null,
  };
}

/**
 * Transform an enrollment record for the Admin's "Class List" view.
 * Includes details about the student.
 * 
 * @param {object} enrollment - The raw enrollment record with user included.
 * @returns {object} The sanitized enrollment with student details.
 */
export function toBootcampStudentResponse(enrollment) {
  if (!enrollment) return null;

  return {
    id: enrollment.id,
    enrolledAt: enrollment.createdAt,
    // Include user details using our existing user model
    student: enrollment.user ? toAdminUserResponse(enrollment.user) : null,
  };
}

/**
 * Transform an array of enrollments for the student view.
 */
export function toMyEnrollmentListResponse(enrollments) {
  if (!enrollments || !Array.isArray(enrollments)) return [];
  return enrollments.map((e) => toMyEnrollmentResponse(e));
}

/**
 * Transform an array of enrollments for the admin view.
 */
export function toBootcampStudentListResponse(enrollments) {
  if (!enrollments || !Array.isArray(enrollments)) return [];
  return enrollments.map((e) => toBootcampStudentResponse(e));
}
