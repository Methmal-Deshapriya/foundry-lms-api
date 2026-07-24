import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as bootcampRepo from "../../../repositories/v1/bootcamps/bootcamp.repository.js";
import * as enrollmentModel from "../../../models/v1/enrollments/enrollment.model.js";
import { enrollUserSchema, updateEnrollmentSchema } from "../../../constants/v1/enrollments/enrollment.schema.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { ValidationError, ConflictError, NotFoundError } from "../../../utils/Errors.js";
import { transformEnrollment } from "../../../utils/transformers.js";

/**
 * Enrollment Service - The "Brain"
 * Orchestrates logic for course access and student management.
 */

/**
 * Service: Manually enroll a student into a bootcamp.
 * @param {object} data - { userId, bootcampId, paymentStatus }.
 * @param {string} actorId - Admin performing the enrollment.
 */
export async function enrollStudentService(data, actorId) {
  // 1. Validation
  const validation = enrollUserSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors?.[0];
    throw new ValidationError(
      firstError?.message || "Validation failed",
      firstError?.path?.[0] || "unknown"
    );
  }

  const { userId, bootcampId, ...extraData } = validation.data;

  // 2. Existence Checks
  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw new NotFoundError("Student not found.");
  }

  if (user.role !== ROLES.STUDENT) {
    throw new ValidationError("Only students can be enrolled in a bootcamp.", "userId");
  }

  const bootcamp = await bootcampRepo.findById(bootcampId);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }

  // 3. Duplicate Check
  const existing = await enrollmentRepo.findExisting(userId, bootcampId);
  if (existing) {
    throw new ConflictError("Student is already enrolled in this bootcamp.");
  }

  // 4. Action: Create the enrollment
  const enrollment = await enrollmentRepo.create(userId, bootcampId, extraData);

  // 5. --- Audit Log ---
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.STUDENT_ENROLLED,
    entityType: ENTITY_TYPES.ENROLLMENT,
    entityId: enrollment.id,
    description: `Student ${user.email} enrolled in "${bootcamp.title}" by Admin ${actorId}`,
    metadata: { studentId: userId, bootcampId: bootcampId, bootcampTitle: bootcamp.title, ...extraData }
  });

  return transformEnrollment(enrollment);
}

/**
 * Service: Update enrollment status or payment (Admin).
 */
export async function updateEnrollmentService(enrollmentId, data, actorId) {
  // 1. Validation
  const validation = updateEnrollmentSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors?.[0];
    throw new ValidationError(
      firstError?.message || "Validation failed",
      firstError?.path?.[0] || "unknown"
    );
  }

  // 2. Existence Check
  const enrollment = await enrollmentRepo.findById(enrollmentId);
  if (!enrollment) {
    throw new NotFoundError("Enrollment not found.");
  }

  // 3. Business Rule: paymentCompletedAt handling
  const updateData = { ...validation.data };
  if (updateData.paymentStatus === "COMPLETED" && !enrollment.paymentCompletedAt) {
    updateData.paymentCompletedAt = new Date().toISOString();
  }

  // 4. Update
  const updated = await enrollmentRepo.update(enrollmentId, updateData);

  // 5. Audit Logging
  if (validation.data.paymentStatus && validation.data.paymentStatus !== enrollment.paymentStatus) {
    recordActionService({
      actorUserId: actorId,
      action: AUDIT_ACTIONS.PAYMENT_STATUS_UPDATED,
      entityType: ENTITY_TYPES.ENROLLMENT,
      entityId: enrollmentId,
      description: `Payment status for enrollment ${enrollmentId} updated to ${validation.data.paymentStatus}`,
      metadata: { oldStatus: enrollment.paymentStatus, newStatus: validation.data.paymentStatus }
    });
  }

  if (validation.data.status === "COMPLETED" && enrollment.status !== "COMPLETED") {
    recordActionService({
      actorUserId: actorId,
      action: AUDIT_ACTIONS.ENROLLMENT_COMPLETED,
      entityType: ENTITY_TYPES.ENROLLMENT,
      entityId: enrollmentId,
      description: `Enrollment ${enrollmentId} marked as COMPLETED`,
    });
  }

  return transformEnrollment(updated);
}

/**
 * Service: Get all enrollments for the current logged-in student.
 */
export async function getMyEnrollmentsService(userId) {
  const enrollments = await enrollmentRepo.findUserEnrollments(userId);
  return enrollmentModel.toMyEnrollmentListResponse(enrollments);
}

/**
 * Service: Get all students enrolled in a specific course (Admin).
 */
export async function getBootcampStudentsService(bootcampId) {
  const bootcamp = await bootcampRepo.findById(bootcampId);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }

  const enrollments = await enrollmentRepo.findBootcampEnrollments(bootcampId);
  return enrollmentModel.toBootcampStudentListResponse(enrollments);
}

/**
 * Service: Search students eligible for manual enrollment in a bootcamp.
 */
export async function getEligibleStudentsForBootcampService(
  bootcampId,
  query = "",
  limit = 5
) {
  const bootcamp = await bootcampRepo.findById(bootcampId);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }

  const sanitizedLimit = Math.min(Math.max(Number(limit) || 5, 1), 5);
  const students = await userRepo.searchEligibleStudentsForBootcamp(
    bootcampId,
    query,
    sanitizedLimit
  );

  return students.map((student) => ({
    id: student.id,
    name: student.name,
    email: student.email,
  }));
}
