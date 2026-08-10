import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

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
    return await prisma.sessionCompletion.create({
      data: { enrollmentId, courseSessionId, courseId },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function removeCompletion(enrollmentId, courseSessionId) {
  try {
    return await prisma.sessionCompletion.deleteMany({
      where: { enrollmentId, courseSessionId },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
