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
  course: { include: { category: { include: { service: true } }, courseGroup: true } },
};

const courseSessionInclude = (enrollmentId) => ({
  session: true,
  completions: {
    where: { enrollmentId },
    select: { id: true, completedAt: true },
    take: 1,
  },
});

export function findEnrollmentContext(enrollmentId) {
  return prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: enrollmentInclude,
  });
}

export function findVisibleSessions(courseId, enrollmentId, now = new Date()) {
  return prisma.courseSession.findMany({
    where: {
      courseId,
      deliveryStatus: { in: ["RELEASED", "SCHEDULED"] },
      OR: [
        { deliveryStatus: "RELEASED" },
        { deliveryStatus: "SCHEDULED", availableAt: { lte: now } },
      ],
      session: { status: { in: ["READY", "ARCHIVED"] } },
    },
    orderBy: [
      { retiredAt: "asc" },
      { orderIndex: "asc" },
      { historicalOrderIndex: "asc" },
    ],
    include: courseSessionInclude(enrollmentId),
  });
}

export function findCompletion(enrollmentId, courseSessionId) {
  return prisma.sessionCompletion.findUnique({
    where: { courseSessionId_enrollmentId: { courseSessionId, enrollmentId } },
  });
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
    select: {
      courseId: true,
      course: { select: { category: { select: { serviceId: true } } } },
    },
  });
  if (!initial || initial.courseId !== courseId) {
    throw new NotFoundError("Enrollment not found.");
  }
  await acquireTransactionLock(
    transaction,
    `learning-service:${initial.course.category.serviceId}`,
  );
  await acquireTransactionLock(transaction, `course:${courseId}`);
  await acquireTransactionLock(transaction, `enrollment:${enrollmentId}`);

  const enrollment = await transaction.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      courseId: true,
      source: true,
      status: true,
      paymentStatus: true,
      course: { select: { status: true, category: { select: { service: true } } } },
    },
  });
  if (!enrollment || enrollment.courseId !== courseId) {
    throw new NotFoundError("Enrollment not found.");
  }
  if (enrollment.status === "COMPLETED") throw new EnrollmentCompletedError();
  if (enrollment.status !== "ACTIVE") {
    throw new ConflictError(
      "Session completion can be changed only for an active enrollment.",
    );
  }
  if (!["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(enrollment.course.status)) {
    throw new ConflictError(
      "Learning progress can be changed only while the course is active.",
    );
  }
  const validAccess =
    enrollment.course.category.service.accessType === "FREE"
      ? enrollment.source === "SELF" && enrollment.paymentStatus === "NOT_REQUIRED"
      : enrollment.source === "ADMIN" && enrollment.paymentStatus === "COMPLETED";
  if (!validAccess) {
    throw new ConflictError("The enrollment does not have valid learning access.");
  }

  const courseSession = await transaction.courseSession.findFirst({
    where: {
      id: courseSessionId,
      courseId,
      deliveryStatus: { in: ["RELEASED", "SCHEDULED"] },
      OR: [
        { deliveryStatus: "RELEASED" },
        { deliveryStatus: "SCHEDULED", availableAt: { lte: now } },
      ],
      session: { status: { in: ["READY", "ARCHIVED"] } },
    },
    select: { id: true },
  });
  if (!courseSession) {
    throw new NotFoundError("This session is not available in the enrollment classroom.");
  }
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
