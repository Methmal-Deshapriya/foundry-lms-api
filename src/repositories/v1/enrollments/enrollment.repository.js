import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import {
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
  certificate: true,
};

export async function createPaid(batchId, userId, actorId, payment) {
  try {
    const enrollmentId = await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `batch-enrollment:${batchId}`);
      const batch = await transaction.batch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundError("Batch not found.");

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
          throw new ConflictError("This batch has reached its enrollment capacity.");
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

export async function createFree(userId, courseId) {
  try {
    return await prisma.enrollment.create({
      data: {
        userId,
        courseId,
        batchId: null,
        source: "SELF",
        enrolledByUserId: null,
        status: "ACTIVE",
        paymentStatus: "NOT_REQUIRED",
      },
      include: enrollmentInclude,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function findById(id) {
  return prisma.enrollment.findUnique({ where: { id }, include: enrollmentInclude });
}

export async function update(id, data) {
  try {
    return await prisma.enrollment.update({
      where: { id },
      data,
      include: enrollmentInclude,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function findFree(userId, courseId) {
  return prisma.enrollment.findFirst({
    where: { userId, courseId, batchId: null },
    include: enrollmentInclude,
  });
}

export async function findUserEnrollments(userId) {
  return prisma.enrollment.findMany({
    where: { userId },
    include: enrollmentInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function findBatchEnrollments(batchId) {
  return prisma.enrollment.findMany({
    where: { batchId },
    include: enrollmentInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function findCourseEnrollments(courseId) {
  return prisma.enrollment.findMany({
    where: { courseId },
    include: enrollmentInclude,
    orderBy: { createdAt: "desc" },
  });
}
