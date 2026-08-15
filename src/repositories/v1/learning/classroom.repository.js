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
      await assertCompletionMutationAllowed(
        transaction,
        enrollmentId,
        courseSessionId,
        courseId,
      );
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
      await assertCompletionMutationAllowed(
        transaction,
        enrollmentId,
        courseSessionId,
        courseId,
      );
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

async function assertCompletionMutationAllowed(
  transaction,
  enrollmentId,
  courseSessionId,
  courseId,
  now = new Date(),
) {
  const initial = await transaction.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { courseId: true, batchId: true },
  });
  if (!initial || initial.courseId !== courseId) {
    throw new NotFoundError("Enrollment not found.");
  }
  await acquireTransactionLock(transaction, `curriculum:${courseId}`);
  if (initial.batchId) {
    await acquireTransactionLock(transaction, `batch:${initial.batchId}`);
  }
  await acquireTransactionLock(transaction, `enrollment:${enrollmentId}`);
  const enrollment = await transaction.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      courseId: true,
      batchId: true,
      source: true,
      status: true,
      paymentStatus: true,
      batch: { select: { status: true } },
    },
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

  const courseSession = await transaction.courseSession.findUnique({
    where: { id: courseSessionId },
    select: {
      courseId: true,
      retiredAt: true,
      session: { select: { status: true } },
    },
  });
  if (
    !courseSession ||
    courseSession.courseId !== courseId ||
    !["READY", "ARCHIVED"].includes(courseSession.session.status)
  ) {
    throw new NotFoundError("This session is not available in the enrollment classroom.");
  }

  if (!enrollment.batchId) {
    if (
      enrollment.source !== "SELF" ||
      enrollment.paymentStatus !== "NOT_REQUIRED" ||
      courseSession.retiredAt
    ) {
      throw new NotFoundError("This session is not available in the enrollment classroom.");
    }
    return;
  }

  if (
    enrollment.source !== "ADMIN" ||
    enrollment.paymentStatus !== "COMPLETED" ||
    enrollment.batch?.status !== "ACTIVE"
  ) {
    throw new ConflictError(
      "Learning progress can be changed only while the batch is active.",
    );
  }
  const delivery = await transaction.batchSession.findUnique({
    where: {
      batchId_courseSessionId: {
        batchId: enrollment.batchId,
        courseSessionId,
      },
    },
    select: { courseId: true, isReleased: true, availableAt: true },
  });
  if (
    !delivery ||
    delivery.courseId !== courseId ||
    !delivery.isReleased ||
    (delivery.availableAt && delivery.availableAt > now)
  ) {
    throw new NotFoundError("This session is not available in the enrollment classroom.");
  }
}
