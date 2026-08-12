import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
  EnrollmentCompletedError,
  NotFoundError,
  handlePrismaError,
} from "../../../utils/Errors.js";
import { acquireTransactionLock } from "./transactionLock.repository.js";

const enrollmentInclude = {
  user: true,
  course: { include: { category: true } },
  batch: true,
};

const courseSessionInclude = (enrollmentId) => ({
  session: true,
  completions: {
    where: { enrollmentId },
    select: { id: true, completedAt: true },
    take: 1,
  },
});

export async function findEnrollmentContext(enrollmentId) {
  return prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: enrollmentInclude,
  });
}

export async function findFreeSessions(courseId, enrollmentId) {
  return prisma.courseSession.findMany({
    where: {
      courseId,
      retiredAt: null,
      session: { status: { in: ["READY", "ARCHIVED"] } },
    },
    orderBy: { orderIndex: "asc" },
    include: courseSessionInclude(enrollmentId),
  });
}

export async function findPaidSessions(batchId, enrollmentId, now = new Date()) {
  const rows = await prisma.batchSession.findMany({
    where: {
      batchId,
      isReleased: true,
      OR: [{ availableAt: null }, { availableAt: { lte: now } }],
      courseSession: {
        session: { status: { in: ["READY", "ARCHIVED"] } },
      },
    },
    include: {
      courseSession: { include: courseSessionInclude(enrollmentId) },
    },
  });
  return rows
    .map((row) => ({
      ...row,
      orderIndex:
        row.courseSession.retiredAt == null
          ? row.courseSession.orderIndex
          : row.historicalOrderIndex,
    }))
    .sort(
      (left, right) =>
        (left.orderIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.orderIndex ?? Number.MAX_SAFE_INTEGER),
    );
}

export async function findCompletion(enrollmentId, courseSessionId) {
  return prisma.sessionCompletion.findUnique({
    where: {
      courseSessionId_enrollmentId: { courseSessionId, enrollmentId },
    },
  });
}

export async function createCompletion(enrollmentId, courseSessionId, courseId) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await assertActiveEnrollment(transaction, enrollmentId, courseId);
      return transaction.sessionCompletion.create({
        data: { enrollmentId, courseSessionId, courseId },
      });
    });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof EnrollmentCompletedError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

export async function removeCompletion(enrollmentId, courseSessionId, courseId) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await assertActiveEnrollment(transaction, enrollmentId, courseId);
      return transaction.sessionCompletion.deleteMany({
        where: { enrollmentId, courseSessionId },
      });
    });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof EnrollmentCompletedError ||
      error instanceof NotFoundError
    ) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

async function assertActiveEnrollment(transaction, enrollmentId, courseId) {
  await acquireTransactionLock(transaction, `enrollment:${enrollmentId}`);
  const enrollment = await transaction.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { courseId: true, status: true },
  });
  if (!enrollment || enrollment.courseId !== courseId) {
    throw new NotFoundError("Enrollment not found.");
  }
  if (enrollment.status === "COMPLETED") {
    throw new EnrollmentCompletedError();
  }
  if (enrollment.status !== "ACTIVE") {
    throw new ConflictError(
      "Session completion can be changed only for an active enrollment.",
    );
  }
}
