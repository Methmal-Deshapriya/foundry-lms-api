import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import * as enrollmentModel from "../../../models/v1/enrollments/enrollment.model.js";
import {
  enrollUserSchema,
  updateEnrollmentSchema,
} from "../../../constants/v1/enrollments/enrollment.schema.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { ValidationError, ConflictError, NotFoundError } from "../../../utils/Errors.js";
import { transformEnrollment } from "../../../utils/transformers.js";
import { assertCourseAcceptsOperationalChanges } from "../catalog/courseLifecycle.service.js";

function parse(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }
  return validation.data;
}

export async function enrollStudentService(data, actorId) {
  const { userId, courseId, ...extraData } = parse(enrollUserSchema, data);
  const [user, course] = await Promise.all([
    userRepo.findUserById(userId),
    courseRepo.findById(courseId),
  ]);
  if (!user) throw new NotFoundError("Student not found.");
  if (user.role !== ROLES.STUDENT) {
    throw new ValidationError("Only students can be enrolled in a course.", "userId");
  }
  if (!course) throw new NotFoundError("Course not found.");
  assertCourseAcceptsOperationalChanges(course);
  if (await enrollmentRepo.findExisting(userId, courseId)) {
    throw new ConflictError("Student is already enrolled in this course.");
  }

  const enrollment = await enrollmentRepo.create(userId, courseId, extraData);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.STUDENT_ENROLLED,
    entityType: ENTITY_TYPES.ENROLLMENT,
    entityId: enrollment.id,
    description: `Student ${user.email} enrolled in "${course.title}" by ${actorId}`,
    metadata: { studentId: userId, courseId, courseTitle: course.title, ...extraData },
  });
  return enrollmentModel.toMyEnrollmentResponse(enrollment);
}

export async function selfEnrollFreeCourseService(courseId, user) {
  const [course, student] = await Promise.all([
    courseRepo.findPublishedFreeById(courseId),
    userRepo.findUserById(user.id),
  ]);
  if (!course) {
    throw new NotFoundError("This free course is not available for enrollment.");
  }
  if (!student || student.role !== ROLES.STUDENT) {
    throw new ValidationError("Only student accounts can self-enroll.", "userId");
  }
  const existing = await enrollmentRepo.findExisting(user.id, courseId);
  if (existing) {
    if (existing.status === "CANCELLED") {
      throw new ConflictError("This enrollment was cancelled. Please contact support.");
    }
    return { enrollment: enrollmentModel.toMyEnrollmentResponse(existing), created: false };
  }

  const enrollment = await enrollmentRepo.create(user.id, courseId, {
    status: "ACTIVE",
    paymentStatus: "NOT_REQUIRED",
  });
  recordActionService({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STUDENT_SELF_ENROLLED,
    entityType: ENTITY_TYPES.ENROLLMENT,
    entityId: enrollment.id,
    description: `Student ${student.email} self-enrolled in free course "${course.title}"`,
    metadata: { courseId, courseTitle: course.title },
  });
  return { enrollment: enrollmentModel.toMyEnrollmentResponse(enrollment), created: true };
}

export async function updateEnrollmentService(enrollmentId, data, actorId) {
  const updateData = { ...parse(updateEnrollmentSchema, data) };
  const enrollment = await enrollmentRepo.findById(enrollmentId);
  if (!enrollment) throw new NotFoundError("Enrollment not found.");

  if (updateData.paymentStatus === "COMPLETED" && !enrollment.paymentCompletedAt) {
    updateData.paymentCompletedAt = new Date();
  } else if (
    updateData.paymentStatus &&
    !["COMPLETED", "NOT_REQUIRED"].includes(updateData.paymentStatus)
  ) {
    updateData.paymentCompletedAt = null;
  }
  if (updateData.status === "COMPLETED" && !enrollment.completedAt) {
    updateData.completedAt = new Date();
  } else if (updateData.status && updateData.status !== "COMPLETED") {
    updateData.completedAt = null;
  }

  const updated = await enrollmentRepo.update(enrollmentId, updateData);
  if (data.paymentStatus && data.paymentStatus !== enrollment.paymentStatus) {
    recordActionService({
      actorUserId: actorId,
      action: AUDIT_ACTIONS.PAYMENT_STATUS_UPDATED,
      entityType: ENTITY_TYPES.ENROLLMENT,
      entityId: enrollmentId,
      description: `Payment status for enrollment ${enrollmentId} updated to ${data.paymentStatus}`,
      metadata: { oldStatus: enrollment.paymentStatus, newStatus: data.paymentStatus },
    });
  }
  if (data.status === "COMPLETED" && enrollment.status !== "COMPLETED") {
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

export async function getMyEnrollmentsService(userId) {
  return enrollmentModel.toMyEnrollmentListResponse(
    await enrollmentRepo.findUserEnrollments(userId)
  );
}

export async function getCourseStudentsService(courseId) {
  if (!(await courseRepo.findById(courseId))) throw new NotFoundError("Course not found.");
  return enrollmentModel.toCourseStudentListResponse(
    await enrollmentRepo.findCourseEnrollments(courseId)
  );
}

export async function getEligibleStudentsForCourseService(courseId, query = "", limit = 5) {
  const course = await courseRepo.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  assertCourseAcceptsOperationalChanges(course);
  const students = await userRepo.searchEligibleStudentsForCourse(
    courseId,
    query,
    Math.min(Math.max(Number(limit) || 5, 1), 20)
  );
  return students.map(({ id, firstName, lastName, email }) => ({
    id,
    firstName,
    lastName,
    email,
  }));
}
