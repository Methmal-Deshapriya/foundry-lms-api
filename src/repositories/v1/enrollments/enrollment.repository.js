import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import {
  BatchCapacityReachedError,
  ConflictError,
  NotFoundError,
  handlePrismaError,
} from "../../../utils/Errors.js";

const courseInclude = { category: true };
const enrollmentInclude = {
  user: true,
  enrolledBy: true,
  course: { include: courseInclude },
  batch: true,
  certificates: {
    where: { status: "ISSUED" },
    orderBy: { issuedDate: "desc" },
    take: 1,
  },
};

export async function createPaid(batchId, userId, actorId, payment) {
  try {
    const enrollmentId = await prisma.$transaction(async (transaction) => {
      const initialBatch = await transaction.batch.findUnique({
        where: { id: batchId },
        select: { courseId: true },
      });
      if (!initialBatch) throw new NotFoundError("Batch not found.");
      await acquireTransactionLock(
        transaction,
        `curriculum:${initialBatch.courseId}`,
      );
      await acquireTransactionLock(transaction, `batch-enrollment:${batchId}`);
      const batch = await transaction.batch.findUnique({
        where: { id: batchId },
        include: { course: { include: { category: true } } },
      });
      const student = await transaction.user.findUnique({
        where: { id: userId },
        select: { role: true, emailVerified: true },
      });
      if (!batch) throw new NotFoundError("Batch not found.");
      if (!student || student.role !== "STUDENT" || !student.emailVerified) {
        throw new ConflictError(
          "The account must remain a verified student while enrollment is created.",
          "INELIGIBLE_STUDENT",
        );
      }
      if (
        !["ENROLLING", "ACTIVE"].includes(batch.status) ||
        batch.course.status !== "PUBLISHED" ||
        batch.course.category.status !== "PUBLISHED" ||
        !["BOOTCAMPS", "PRETECH"].includes(batch.course.category.serviceType)
      ) {
        throw new ConflictError(
          "This batch is no longer accepting enrollment.",
          "BATCH_ENROLLMENT_CLOSED",
        );
      }

      const existing = await transaction.enrollment.findFirst({
        where: { userId, batchId },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError("Student is already enrolled in this batch.");
      }

      if (batch.capacity != null) {
        const occupied = await transaction.enrollment.count({
          where: { batchId, status: { not: "CANCELLED" } },
        });
        if (occupied >= batch.capacity) {
          throw new BatchCapacityReachedError();
        }
      }

      const enrollment = await transaction.enrollment.create({
        data: {
          userId,
          courseId: batch.courseId,
          batchId,
          source: "ADMIN",
          enrolledByUserId: actorId,
          status: "ACTIVE",
          ...payment,
        },
        select: { id: true },
      });
      return enrollment.id;
    });
    return await findById(enrollmentId);
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function enrollFree(userId, courseId) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${courseId}`);
      await acquireTransactionLock(transaction, `free-enrollment:${courseId}`);
      const course = await transaction.course.findFirst({
        where: {
          id: courseId,
          status: "PUBLISHED",
          accessType: "FREE",
          enrollmentStatus: "OPEN",
          category: { status: "PUBLISHED", serviceType: "FREE_LEARNING" },
          courseSessions: { some: { retiredAt: null } },
        },
        select: { id: true },
      });
      if (!course) {
        throw new ConflictError("This Free Learning course is not open for enrollment.");
      }

      const existing = await transaction.enrollment.findFirst({
        where: {
          userId,
          courseId,
          batchId: null,
          source: "SELF",
        },
        select: { id: true, status: true },
      });
      if (existing) {
        await acquireTransactionLock(transaction, `enrollment:${existing.id}`);
        const current = await transaction.enrollment.findUnique({
          where: { id: existing.id },
          select: { id: true, status: true },
        });
        if (!current) throw new NotFoundError("Enrollment not found.");
        if (current.status !== "CANCELLED") {
          return { enrollmentId: current.id, outcome: "EXISTING" };
        }

        await transaction.enrollment.update({
          where: { id: current.id },
          data: { status: "ACTIVE", completedAt: null },
        });
        return { enrollmentId: current.id, outcome: "REACTIVATED" };
      }

      const enrollment = await transaction.enrollment.create({
        data: {
          userId,
          courseId,
          batchId: null,
          source: "SELF",
          enrolledByUserId: null,
          status: "ACTIVE",
          paymentStatus: "NOT_REQUIRED",
        },
        select: { id: true },
      });
      return { enrollmentId: enrollment.id, outcome: "CREATED" };
    });
    return {
      enrollment: await findById(result.enrollmentId),
      outcome: result.outcome,
    };
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function findById(id) {
  return prisma.enrollment.findUnique({ where: { id }, include: enrollmentInclude });
}

export async function update(id, expected, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `enrollment:${id}`);
      const current = await transaction.enrollment.findUnique({
        where: { id },
        select: { status: true, paymentStatus: true },
      });
      if (!current) throw new NotFoundError("Enrollment not found.");
      if (
        current.status !== expected.status ||
        current.paymentStatus !== expected.paymentStatus
      ) {
        throw new ConflictError(
          "The enrollment or payment status changed while this request was being processed. Refresh and try again.",
        );
      }
      return transaction.enrollment.update({
        where: { id },
        data,
        include: enrollmentInclude,
      });
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function findUserEnrollments(userId) {
  return prisma.enrollment.findMany({
    where: { userId },
    include: enrollmentInclude,
    orderBy: { createdAt: "desc" },
  });
}

function rosterWhere(scope, q, status, cursor) {
  return {
    ...scope,
    ...(status ? { status } : {}),
    ...(q
      ? {
          user: {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  };
}

export async function findBatchEnrollments(
  batchId,
  { q = "", status, limit = 50, cursor = null },
) {
  return prisma.enrollment.findMany({
    where: rosterWhere({ batchId }, q, status, cursor),
    include: enrollmentInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
}

export async function findCourseEnrollments(
  courseId,
  { q = "", status, limit = 50, cursor = null },
) {
  return prisma.enrollment.findMany({
    where: rosterWhere({ courseId }, q, status, cursor),
    include: enrollmentInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
}
