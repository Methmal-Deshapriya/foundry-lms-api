import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as bootcampRepo from "../../../repositories/v1/bootcamps/bootcamp.repository.js";
import * as enrollmentModel from "../../../models/v1/enrollments/enrollment.model.js";
import { enrollUserSchema } from "../../../constants/v1/enrollments/enrollment.schema.js";
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
} from "../../../utils/Errors.js";

/**
 * Enrollment Service - The "Brain"
 * Orchestrates logic for course access and student management.
 */

/**
 * Service: Manually enroll a student into a bootcamp.
 * 1. Validate the input IDs.
 * 2. Verify that the student exists.
 * 3. Verify that the bootcamp exists.
 * 4. Check for existing enrollment (prevent duplicates).
 * 5. Create the record.
 *
 * @param {object} data - { userId, bootcampId }.
 * @returns {Promise<object>} The sanitized enrollment record.
 */
export async function enrollStudentService(data) {
  // 1. Validation: Ensure IDs are valid UUIDs
  const validation = enrollUserSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { userId, bootcampId } = validation.data;

  // 2. Existence Check: Does the user exist?
  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw new NotFoundError("Student not found.");
  }

  // 3. Existence Check: Does the bootcamp exist?
  const bootcamp = await bootcampRepo.findById(bootcampId);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }
  // 4. Business Rule: Is the bootcamp published? (Only allow enrollment if published)
  if (bootcamp.isPublished === false) {
    throw new ForbiddenError("Bootcamp is not currently published.");
  }

  // 4. Duplicate Check: Is the student already enrolled?
  const existing = await enrollmentRepo.findExisting(userId, bootcampId);
  if (existing) {
    throw new ConflictError("Student is already enrolled in this bootcamp.");
  }

  // 5. Action: Create the enrollment
  const enrollment = await enrollmentRepo.create(userId, bootcampId);

  // 6. Return sanitized response (for admin view)
  return enrollment;
}

/**
 * Service: Get all enrollments for the current logged-in student.
 * @param {string} userId - UUID of the authenticated user.
 * @returns {Promise<Array>} List of sanitized course enrollments.
 */
export async function getMyEnrollmentsService(userId) {
  const enrollments = await enrollmentRepo.findUserEnrollments(userId);
  return enrollmentModel.toMyEnrollmentListResponse(enrollments);
}

/**
 * Service: Get all students enrolled in a specific course (Admin).
 * @param {string} bootcampId - UUID of the course.
 * @returns {Promise<Array>} List of sanitized student profiles.
 */
export async function getBootcampStudentsService(bootcampId) {
  // Verify bootcamp exists first
  const bootcamp = await bootcampRepo.findById(bootcampId);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }

  const enrollments = await enrollmentRepo.findBootcampEnrollments(bootcampId);
  return enrollmentModel.toBootcampStudentListResponse(enrollments);
}
