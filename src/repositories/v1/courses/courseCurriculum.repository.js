import prisma from "../../../utils/prisma.js";
import { isSelfPacedService } from "../../../constants/v1/catalog/learningServicePolicy.constants.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  handlePrismaError,
} from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const curriculumInclude = {
  session: true,
  _count: { select: { batchLinks: true, completions: true } },
};

async function moveActiveLinksOutOfRange(transaction, courseId) {
  await transaction.courseSession.updateMany({
    where: { courseId, retiredAt: null },
    data: { orderIndex: { increment: 1_000_000 } },
  });
}

async function assignContinuousOrder(transaction, orderedIds) {
  await Promise.all(
    orderedIds.map((id, orderIndex) =>
      transaction.courseSession.update({
        where: { id },
        data: { orderIndex, retiredAt: null },
      }),
    ),
  );
}

async function attachWithinTransaction(
  transaction,
  courseId,
  sessionId,
  requestedOrderIndex,
) {
  await acquireTransactionLock(transaction, `curriculum:${courseId}`);
  await acquireTransactionLock(transaction, `session:${sessionId}`);

  const session = await transaction.session.findUnique({
    where: { id: sessionId },
    include: {
      courseSessions: { select: { id: true, courseId: true, retiredAt: true } },
    },
  });
  if (!session) throw new NotFoundError("Session not found.");
  if (session.status !== "READY") {
    throw new ConflictError("Only ready sessions can be attached to a course.");
  }

  const existingForCourse = session.courseSessions.find(
    (courseSession) => courseSession.courseId === courseId,
  );
  if (existingForCourse && !existingForCourse.retiredAt) {
    throw new ConflictError("This session is already active in the course curriculum.");
  }
  if (
    session.reusePolicy === "SINGLE_COURSE" &&
    session.courseSessions.some((courseSession) => courseSession.courseId !== courseId)
  ) {
    throw new ConflictError("This one-course session is locked to another course.");
  }

  const activeLinks = await transaction.courseSession.findMany({
    where: { courseId, retiredAt: null },
    orderBy: { orderIndex: "asc" },
    select: { id: true },
  });
  const orderIndex = requestedOrderIndex ?? activeLinks.length;
  if (orderIndex < 0 || orderIndex > activeLinks.length) {
    throw new ValidationError(
      `Order index must be between 0 and ${activeLinks.length}.`,
      "orderIndex",
    );
  }

  let courseSessionId = existingForCourse?.id;
  if (!courseSessionId) {
    const relation = await transaction.courseSession.create({
      data: {
        courseId,
        sessionId,
        orderIndex: null,
        retiredAt: new Date(),
      },
      select: { id: true },
    });
    courseSessionId = relation.id;
  }

  await moveActiveLinksOutOfRange(transaction, courseId);
  const orderedIds = activeLinks.map(({ id }) => id);
  orderedIds.splice(orderIndex, 0, courseSessionId);
  await assignContinuousOrder(transaction, orderedIds);
  return courseSessionId;
}

export async function findByCourseId(courseId, includeRetired = false) {
  return prisma.courseSession.findMany({
    where: { courseId, ...(includeRetired ? {} : { retiredAt: null }) },
    orderBy: [{ retiredAt: "asc" }, { orderIndex: "asc" }, { createdAt: "asc" }],
    include: curriculumInclude,
  });
}

export async function findById(id) {
  return prisma.courseSession.findUnique({
    where: { id },
    include: curriculumInclude,
  });
}

export async function attachExisting(courseId, sessionId, orderIndex) {
  try {
    const courseSessionId = await prisma.$transaction((transaction) =>
      attachWithinTransaction(transaction, courseId, sessionId, orderIndex),
    );
    return await findById(courseSessionId);
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof NotFoundError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

export async function createAndAttach(courseId, sessionData, orderIndex) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${courseId}`);
      const session = await transaction.session.create({
        data: { ...sessionData, status: "READY" },
        select: { id: true },
      });
      const courseSessionId = await attachWithinTransaction(
        transaction,
        courseId,
        session.id,
        orderIndex,
      );
      return { sessionId: session.id, courseSessionId };
    });
    return { ...result, courseSession: await findById(result.courseSessionId) };
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof NotFoundError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

export async function reorder(courseId, orderedCourseSessions) {
  try {
    await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${courseId}`);
      const activeLinks = await transaction.courseSession.findMany({
        where: { courseId, retiredAt: null },
        orderBy: { orderIndex: "asc" },
        select: { id: true },
      });
      const expectedIds = new Set(activeLinks.map(({ id }) => id));
      const suppliedIds = new Set(orderedCourseSessions.map(({ id }) => id));
      if (
        expectedIds.size !== suppliedIds.size ||
        [...suppliedIds].some((id) => !expectedIds.has(id))
      ) {
        throw new ValidationError(
          "Reordering must include every active course session exactly once.",
          "courseSessions",
        );
      }

      await moveActiveLinksOutOfRange(transaction, courseId);
      await assignContinuousOrder(
        transaction,
        [...orderedCourseSessions]
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map(({ id }) => id),
      );
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw handlePrismaError(error);
  }
}

export async function removeOrRetire(id, serviceType) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.courseSession.findUnique({
        where: { id },
        select: { courseId: true },
      });
      if (!initial) throw new NotFoundError("Course session not found.");

      await acquireTransactionLock(transaction, `curriculum:${initial.courseId}`);
      await acquireTransactionLock(transaction, `course-session:${id}`);

      const courseSession = await transaction.courseSession.findUnique({
        where: { id },
        include: {
          _count: { select: { batchLinks: true, completions: true } },
          course: { select: { _count: { select: { enrollments: true } } } },
        },
      });
      if (!courseSession) throw new NotFoundError("Course session not found.");

      const hasHistory =
        courseSession._count.batchLinks > 0 ||
        courseSession._count.completions > 0 ||
        (isSelfPacedService(serviceType) &&
          courseSession.course._count.enrollments > 0);

      if (courseSession.retiredAt) {
        if (hasHistory) return { id, action: "RETIRED" };
        await transaction.courseSession.delete({ where: { id } });
        return { id, action: "DETACHED" };
      }

      const remaining = await transaction.courseSession.findMany({
        where: {
          courseId: courseSession.courseId,
          retiredAt: null,
          id: { not: id },
        },
        orderBy: { orderIndex: "asc" },
        select: { id: true },
      });
      await moveActiveLinksOutOfRange(transaction, courseSession.courseId);

      if (hasHistory) {
        await transaction.courseSession.update({
          where: { id },
          data: { orderIndex: null, retiredAt: new Date() },
        });
      } else {
        await transaction.courseSession.delete({ where: { id } });
      }
      await assignContinuousOrder(
        transaction,
        remaining.map(({ id: remainingId }) => remainingId),
      );
      return { id, action: hasHistory ? "RETIRED" : "DETACHED" };
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}
