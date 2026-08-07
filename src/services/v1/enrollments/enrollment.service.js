import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import * as batchRepo from "../../../repositories/v1/batches/batch.repository.js";
import * as enrollmentModel from "../../../models/v1/enrollments/enrollment.model.js";
import {
  bulkManualEnrollmentSchema,
  eligibleStudentFiltersSchema,
  manualEnrollmentSchema,
  updateEnrollmentSchema,
} from "../../../constants/v1/enrollments/enrollment.schema.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
} from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../utils/Errors.js";
import { assertCourseAcceptsOperationalChanges } from "../catalog/courseLifecycle.service.js";
import {
  assertCohortService,
  assertSelfPacedService,
} from "../catalog/learningServicePolicy.service.js";

function parse(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(
      issue?.message ?? "Validation failed.",
      issue?.path?.join(".") || null,
    );
  }
  return validation.data;
}

function assertVerifiedStudent(user, userId) {
  if (!user) throw new NotFoundError("Student not found.");
  if (user.role !== ROLES.STUDENT) {
    throw new ValidationError("Only student accounts can be enrolled.", "userId");
  }
  if (!user.emailVerified) {
    throw new ConflictError(`Student ${userId} must verify their email before enrollment.`);
  }
}

function assertBatchAcceptsEnrollments(batch) {
  if (!batch) throw new NotFoundError("Batch not found.");
  assertCohortService(batch.course.category.serviceType);
  assertCourseAcceptsOperationalChanges(batch.course);
  if (
    batch.course.status !== "PUBLISHED" ||
    batch.course.category.status !== "PUBLISHED"
  ) {
    throw new ConflictError("New students can be enrolled only in a published course.");
  }
  if (!['ENROLLING', 'ACTIVE'].includes(batch.status)) {
    throw new ConflictError("This batch is not accepting enrollments.");
  }
}

function paidEnrollmentData(input) {
  return {
    paymentStatus: input.paymentStatus,
    paymentCompletedAt:
      input.paymentStatus === "COMPLETED" ? new Date() : null,
    externalPaymentReference: input.externalPaymentReference ?? null,
    paymentNote: input.paymentNote ?? null,
  };
}

function auditPaidEnrollment(enrollment, user, batch, actorId) {
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.STUDENT_ENROLLED,
    entityType: ENTITY_TYPES.ENROLLMENT,
    entityId: enrollment.id,
    description: `Student ${user.email} enrolled in batch "${batch.name}".`,
    metadata: {
      studentId: user.id,
      courseId: batch.courseId,
      batchId: batch.id,
      paymentStatus: enrollment.paymentStatus,
      externalPaymentReference: enrollment.externalPaymentReference,
    },
  });
}

export async function enrollStudentInBatchService(batchId, data, actorId) {
  const input = parse(manualEnrollmentSchema, data);
  const [batch, student] = await Promise.all([
    batchRepo.findById(batchId),
    userRepo.findUserById(input.userId),
  ]);
  assertBatchAcceptsEnrollments(batch);
  assertVerifiedStudent(student, input.userId);

  const enrollment = await enrollmentRepo.createPaid(
    batchId,
    input.userId,
    actorId,
    paidEnrollmentData(input),
  );
  auditPaidEnrollment(enrollment, student, batch, actorId);
  return enrollmentModel.toAdminEnrollmentResponse(enrollment);
}

export async function bulkEnrollStudentsInBatchService(batchId, data, actorId) {
  const { students } = parse(bulkManualEnrollmentSchema, data);
  const batch = await batchRepo.findById(batchId);
  assertBatchAcceptsEnrollments(batch);

  const users = await userRepo.findVerifiedStudentsByIds(
    students.map(({ userId }) => userId),
  );
  const usersById = new Map(users.map((user) => [user.id, user]));
  const results = [];

  // Sequential writes keep capacity decisions deterministic; each write also
  // holds a short database advisory lock so concurrent requests remain safe.
  for (const input of students) {
    const student = usersById.get(input.userId);
    if (!student) {
      results.push({
        userId: input.userId,
        status: "FAILED",
        code: "INELIGIBLE_STUDENT",
        error: "Student was not found, is unverified, or is not a student account.",
      });
      continue;
    }
    try {
      const enrollment = await enrollmentRepo.createPaid(
        batchId,
        input.userId,
        actorId,
        paidEnrollmentData(input),
      );
      auditPaidEnrollment(enrollment, student, batch, actorId);
      results.push({
        userId: input.userId,
        status: "CREATED",
        enrollment: enrollmentModel.toAdminEnrollmentResponse(enrollment),
      });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      results.push({
        userId: input.userId,
        status: "FAILED",
        code: error.code,
        error: error.message,
      });
    }
  }

  const createdCount = results.filter(({ status }) => status === "CREATED").length;
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.STUDENTS_BULK_ENROLLED,
    entityType: ENTITY_TYPES.BATCH,
    entityId: batchId,
    description: `${createdCount} of ${students.length} students enrolled in batch "${batch.name}".`,
    metadata: {
      batchId,
      courseId: batch.courseId,
      requestedCount: students.length,
      createdCount,
      failedCount: students.length - createdCount,
    },
  });
  return {
    results,
    summary: {
      requested: students.length,
      created: createdCount,
      failed: students.length - createdCount,
    },
  };
}

export async function selfEnrollFreeCourseService(courseId, user) {
  const [course, student] = await Promise.all([
    courseRepo.findPublishedFreeById(courseId),
    userRepo.findUserById(user.id),
  ]);
  if (!course) {
    throw new NotFoundError("This Free Learning course is not available for enrollment.");
  }
  assertSelfPacedService(course.category.serviceType);
  assertVerifiedStudent(student, user.id);

  const existing = await enrollmentRepo.findFree(user.id, courseId);
  if (existing) {
    if (existing.status === "CANCELLED") {
      throw new ConflictError("This enrollment was cancelled. Please contact support.");
    }
    return {
      enrollment: enrollmentModel.toMyEnrollmentResponse(existing),
      created: false,
    };
  }

  let enrollment;
  try {
    enrollment = await enrollmentRepo.createFree(user.id, courseId);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    enrollment = await enrollmentRepo.findFree(user.id, courseId);
    if (!enrollment) throw error;
    if (enrollment.status === "CANCELLED") {
      throw new ConflictError("This enrollment was cancelled. Please contact support.");
    }
    return {
      enrollment: enrollmentModel.toMyEnrollmentResponse(enrollment),
      created: false,
    };
  }

  recordActionService({
    actorUserId: user.id,
    action: AUDIT_ACTIONS.STUDENT_SELF_ENROLLED,
    entityType: ENTITY_TYPES.ENROLLMENT,
    entityId: enrollment.id,
    description: `Student ${student.email} self-enrolled in "${course.title}".`,
    metadata: { courseId, courseTitle: course.title },
  });
  return {
    enrollment: enrollmentModel.toMyEnrollmentResponse(enrollment),
    created: true,
  };
}

export async function updateEnrollmentService(enrollmentId, data, actorId) {
  const input = parse(updateEnrollmentSchema, data);
  const enrollment = await enrollmentRepo.findById(enrollmentId);
  if (!enrollment) throw new NotFoundError("Enrollment not found.");

  const paymentFields = [
    "paymentStatus",
    "externalPaymentReference",
    "paymentNote",
  ];
  if (
    enrollment.source === "SELF" &&
    paymentFields.some((field) => Object.hasOwn(input, field))
  ) {
    throw new ConflictError("Payment details cannot be changed for free self-enrollment.");
  }

  const updateData = { ...input };
  const effectivePaymentStatus = input.paymentStatus ?? enrollment.paymentStatus;
  if (
    input.status === "COMPLETED" &&
    enrollment.source === "ADMIN" &&
    effectivePaymentStatus !== "COMPLETED"
  ) {
    throw new ConflictError(
      "Paid enrollment cannot be completed before payment is completed.",
    );
  }
  if (input.paymentStatus) {
    updateData.paymentCompletedAt =
      input.paymentStatus === "COMPLETED" ? new Date() : null;
  }
  if (input.status) {
    updateData.completedAt = input.status === "COMPLETED" ? new Date() : null;
  }

  const updated = await enrollmentRepo.update(enrollmentId, updateData);
  if (input.paymentStatus && input.paymentStatus !== enrollment.paymentStatus) {
    recordActionService({
      actorUserId: actorId,
      action: AUDIT_ACTIONS.PAYMENT_STATUS_UPDATED,
      entityType: ENTITY_TYPES.ENROLLMENT,
      entityId: enrollmentId,
      description: `Enrollment payment moved from ${enrollment.paymentStatus} to ${input.paymentStatus}.`,
      metadata: {
        oldStatus: enrollment.paymentStatus,
        newStatus: input.paymentStatus,
        batchId: enrollment.batchId,
      },
    });
  }
  if (input.status && input.status !== enrollment.status) {
    recordActionService({
      actorUserId: actorId,
      action:
        input.status === "COMPLETED"
          ? AUDIT_ACTIONS.ENROLLMENT_COMPLETED
          : AUDIT_ACTIONS.ENROLLMENT_STATUS_UPDATED,
      entityType: ENTITY_TYPES.ENROLLMENT,
      entityId: enrollmentId,
      description: `Enrollment moved from ${enrollment.status} to ${input.status}.`,
      metadata: {
        oldStatus: enrollment.status,
        newStatus: input.status,
        batchId: enrollment.batchId,
      },
    });
  }
  return enrollmentModel.toAdminEnrollmentResponse(updated);
}

export async function getMyEnrollmentsService(userId) {
  return enrollmentModel.toMyEnrollmentListResponse(
    await enrollmentRepo.findUserEnrollments(userId),
  );
}

export async function getBatchEnrollmentsService(batchId) {
  const batch = await batchRepo.findById(batchId);
  if (!batch) throw new NotFoundError("Batch not found.");
  assertCohortService(batch.course.category.serviceType);
  return enrollmentModel.toAdminEnrollmentListResponse(
    await enrollmentRepo.findBatchEnrollments(batchId),
  );
}

export async function getCourseStudentsService(courseId) {
  if (!(await courseRepo.findById(courseId))) {
    throw new NotFoundError("Course not found.");
  }
  return enrollmentModel.toAdminEnrollmentListResponse(
    await enrollmentRepo.findCourseEnrollments(courseId),
  );
}

export async function getEligibleStudentsForBatchService(batchId, query = {}) {
  const batch = await batchRepo.findById(batchId);
  assertBatchAcceptsEnrollments(batch);
  const filters = parse(eligibleStudentFiltersSchema, query);
  const students = await userRepo.searchEligibleStudentsForBatch(
    batchId,
    filters.q,
    filters.limit,
  );
  return students.map(({ id, firstName, lastName, email }) => ({
    id,
    firstName,
    lastName,
    email,
  }));
}
