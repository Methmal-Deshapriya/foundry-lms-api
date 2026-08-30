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
      intakeId: true,
      orderIndex: true,
      deliveryStatus: true,
      retiredAt: true,
      intake: {
        select: {
          code: true,
          courseId: true,
          categoryId: true,
          course: { select: { title: true } },
          category: {
            select: {
              service: { select: { slug: true } },
            },
          },
        },
      },
    },
  },
};

export async function findAdmin(filters, limit, offset) {
  const attachabilityConditions = filters.attachableIntakeId
    ? [
        {
          courseSessions: {
            none: {
              intakeId: filters.attachableIntakeId,
            },
          },
        },
      ]
    : [];

  // Postgres array columns have no "element contains substring" filter in
  // Prisma's query builder (only exact has/hasSome/hasEvery), so a partial,
  // as-you-type tag match is resolved with a small raw pre-query and folded
  // back in as an `id IN (...)` condition alongside every other filter.
  const tagMatchIds = filters.tag
    ? (
        await prisma.$queryRaw`
          SELECT id FROM sessions
          WHERE EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ${`%${filters.tag}%`})
        `
      ).map((row) => row.id)
    : null;

  // Shared with everything except the status pill itself, so the per-status
  // counts below reflect the current search/tag/attachability filters while
  // still counting every status (not just whichever one is selected).
  const sharedConditions = {
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { description: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(tagMatchIds ? { id: { in: tagMatchIds } } : {}),
    ...(attachabilityConditions.length > 0
      ? { AND: attachabilityConditions }
      : {}),
  };

  const where = {
    ...(filters.attachableIntakeId
      ? { status: "READY" }
      : filters.status
        ? { status: filters.status }
        : {}),
    ...sharedConditions,
  };

  const [total, sessions, statusCounts] = await Promise.all([
    prisma.session.count({ where }),
    prisma.session.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { title: "asc" }],
      take: limit,
      skip: offset,
      include: usageInclude,
    }),
    prisma.session.groupBy({
      by: ["status"],
      where: sharedConditions,
      _count: true,
    }),
  ]);

  return { total, sessions, statusCounts };
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
      courseSessions: { select: { intakeId: true } },
    },
  });
  if (!initial) throw new NotFoundError("Session not found.");

  const intakeIds = [
    ...new Set(initial.courseSessions.map(({ intakeId }) => intakeId)),
  ].sort();
  for (const intakeId of intakeIds) {
    await acquireTransactionLock(transaction, `intake:${intakeId}`);
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

export async function duplicate(id) {
  const source = await prisma.session.findUnique({ where: { id } });
  if (!source) throw new NotFoundError("Session not found.");
  try {
    return await prisma.session.create({
      data: {
        title: `${source.title} (Copy)`,
        description: source.description,
        recordingUrl: source.recordingUrl,
        materialUrl: source.materialUrl,
        quizUrl: source.quizUrl,
        feedbackUrl: source.feedbackUrl,
        durationMinutes: source.durationMinutes,
        tags: source.tags,
        status: "DRAFT",
      },
      include: usageInclude,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function archiveMany(ids) {
  const results = [];
  for (const id of ids) {
    try {
      const { previous, session, changed } = await archiveSafely(id);
      results.push({ id, status: "ARCHIVED", title: previous.title, changed, session });
    } catch (error) {
      if (
        error instanceof ConflictError ||
        error instanceof NotFoundError ||
        error instanceof ValidationError
      ) {
        results.push({ id, status: "FAILED", error: error.message });
        continue;
      }
      throw error;
    }
  }
  return results;
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
