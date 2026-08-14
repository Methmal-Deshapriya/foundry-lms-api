import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  handlePrismaError,
} from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const usageInclude = {
  courseSessions: {
    orderBy: [{ retiredAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      courseId: true,
      orderIndex: true,
      retiredAt: true,
      course: { select: { title: true } },
      _count: { select: { batchLinks: true } },
    },
  },
};

export async function findAdmin(filters, limit, offset) {
  const attachabilityConditions = filters.attachableCourseId
    ? [
        {
          courseSessions: {
            none: {
              courseId: filters.attachableCourseId,
            },
          },
        },
        {
          OR: [
            { reusePolicy: "REUSABLE" },
            {
              reusePolicy: "SINGLE_COURSE",
              courseSessions: {
                none: { courseId: { not: filters.attachableCourseId } },
              },
            },
          ],
        },
      ]
    : [];

  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.reusePolicy ? { reusePolicy: filters.reusePolicy } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { description: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(attachabilityConditions.length > 0
      ? { AND: attachabilityConditions }
      : {}),
  };

  const [total, sessions] = await Promise.all([
    prisma.session.count({ where }),
    prisma.session.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      take: limit,
      skip: offset,
      include: usageInclude,
    }),
  ]);

  return { total, sessions };
}

export async function findById(id) {
  return prisma.session.findUnique({
    where: { id },
    include: usageInclude,
  });
}

export async function create(data) {
  try {
    return await prisma.session.create({ data, include: usageInclude });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

async function lockSessionContext(transaction, id) {
  const initial = await transaction.session.findUnique({
    where: { id },
    select: {
      courseSessions: { select: { courseId: true } },
    },
  });
  if (!initial) throw new NotFoundError("Session not found.");

  const courseIds = [
    ...new Set(initial.courseSessions.map(({ courseId }) => courseId)),
  ].sort();
  for (const courseId of courseIds) {
    await acquireTransactionLock(transaction, `curriculum:${courseId}`);
  }
  await acquireTransactionLock(transaction, `session:${id}`);

  const session = await transaction.session.findUnique({
    where: { id },
    include: usageInclude,
  });
  if (!session) throw new NotFoundError("Session not found.");
  return session;
}

function rethrowSessionMutationError(error) {
  if (
    error instanceof ConflictError ||
    error instanceof NotFoundError ||
    error instanceof ValidationError
  ) {
    throw error;
  }
  throw handlePrismaError(error);
}

export async function updateSafely(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await lockSessionContext(transaction, id);
      if (current.status === "ARCHIVED") {
        throw new ConflictError("Archived sessions must be restored before editing.");
      }
      if (
        data.reusePolicy === "SINGLE_COURSE" &&
        current.reusePolicy !== "SINGLE_COURSE" &&
        current.courseSessions.length > 1
      ) {
        throw new ConflictError(
          "A session used by multiple courses cannot become a one-course session.",
        );
      }
      if (data.status === "DRAFT" && current.courseSessions.length > 0) {
        throw new ConflictError(
          "A session used by a course cannot return to draft. Archive it to stop new use while preserving learner access.",
        );
      }
      const resultingStatus = data.status ?? current.status;
      const resultingRecordingUrl =
        data.recordingUrl !== undefined ? data.recordingUrl : current.recordingUrl;
      if (resultingStatus === "READY" && !resultingRecordingUrl) {
        throw new ValidationError(
          "A ready session must have a recording URL.",
          "recordingUrl",
        );
      }

      const changedFields = Object.keys(data).filter(
        (field) => (current[field] ?? null) !== (data[field] ?? null),
      );
      if (changedFields.length === 0) {
        return { previous: current, session: current, changedFields };
      }
      const session = await transaction.session.update({
        where: { id },
        data,
        include: usageInclude,
      });
      return { previous: current, session, changedFields };
    });
  } catch (error) {
    rethrowSessionMutationError(error);
  }
}

export async function archiveSafely(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await lockSessionContext(transaction, id);
      if (current.status === "ARCHIVED") {
        return { previous: current, session: current, changed: false };
      }
      const session = await transaction.session.update({
        where: { id },
        data: { status: "ARCHIVED" },
        include: usageInclude,
      });
      return { previous: current, session, changed: true };
    });
  } catch (error) {
    rethrowSessionMutationError(error);
  }
}

export async function restoreSafely(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const current = await lockSessionContext(transaction, id);
      if (current.status !== "ARCHIVED") {
        throw new ConflictError("Only archived sessions can be restored.");
      }
      const restoredStatus =
        current.courseSessions.length > 0 ? "READY" : "DRAFT";
      if (restoredStatus === "READY" && !current.recordingUrl) {
        throw new ConflictError(
          "This used session cannot be restored until its recording is available.",
        );
      }
      const session = await transaction.session.update({
        where: { id },
        data: { status: restoredStatus },
        include: usageInclude,
      });
      return { previous: current, session, restoredStatus };
    });
  } catch (error) {
    rethrowSessionMutationError(error);
  }
}

export async function removePermanently(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const locked = await transaction.session.updateMany({
        where: { id, status: "ARCHIVED" },
        data: { status: "ARCHIVED" },
      });
      if (locked.count !== 1) {
        throw new ConflictError("Only archived sessions can be permanently deleted.");
      }

      const courseUsageCount = await transaction.courseSession.count({
        where: { sessionId: id },
      });
      if (courseUsageCount > 0) {
        throw new ConflictError(
          "This session has curriculum or delivery history and cannot be permanently deleted.",
        );
      }

      await transaction.session.delete({ where: { id } });
      return { id, deletedSessions: 1 };
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    if (error?.code === "P2003") {
      throw new ConflictError(
        "This session is still referenced by learning-delivery history.",
      );
    }
    throw handlePrismaError(error);
  }
}
