import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  handlePrismaError,
} from "../../../utils/Errors.js";

const batchInclude = {
  course: { include: { category: true } },
  _count: { select: { sessions: true, enrollments: true } },
};

const batchSessionInclude = {
  courseSession: { include: { session: true } },
};

async function copyActiveCurriculum(transaction, batch) {
  const curriculum = await transaction.courseSession.findMany({
    where: { courseId: batch.courseId, retiredAt: null },
    orderBy: { orderIndex: "asc" },
    select: { id: true, orderIndex: true },
  });
  if (curriculum.length > 0) {
    await transaction.batchSession.createMany({
      data: curriculum.map((courseSession) => ({
        batchId: batch.id,
        courseSessionId: courseSession.id,
        courseId: batch.courseId,
        orderIndex: courseSession.orderIndex,
        isReleased: false,
      })),
    });
  }
  return curriculum.length;
}

async function moveBatchSessionsOutOfRange(transaction, batchId) {
  await transaction.batchSession.updateMany({
    where: { batchId },
    data: { orderIndex: { increment: 1_000_000 } },
  });
}

async function assignBatchOrder(transaction, orderedIds) {
  await Promise.all(
    orderedIds.map((id, orderIndex) =>
      transaction.batchSession.update({
        where: { id },
        data: { orderIndex },
      }),
    ),
  );
}

export async function findAdminByCourse(courseId, filters, limit, offset) {
  const where = {
    courseId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { code: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, batches] = await Promise.all([
    prisma.batch.count({ where }),
    prisma.batch.findMany({
      where,
      orderBy: [{ startDate: "desc" }, { name: "asc" }],
      take: limit,
      skip: offset,
      include: batchInclude,
    }),
  ]);
  return { total, batches };
}

export async function findById(id) {
  return prisma.batch.findUnique({ where: { id }, include: batchInclude });
}

export async function create(courseId, data, initializeCurriculum) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${courseId}`);
      const batch = await transaction.batch.create({
        data: { ...data, courseId },
      });
      const initializedSessionCount = initializeCurriculum
        ? await copyActiveCurriculum(transaction, batch)
        : 0;
      return { batchId: batch.id, initializedSessionCount };
    });
    return { batch: await findById(result.batchId), ...result };
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.batch.update({
      where: { id },
      data,
      include: batchInclude,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function initializeCurriculum(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.batch.findUnique({
        where: { id },
        select: { courseId: true },
      });
      if (!initial) throw new NotFoundError("Batch not found.");
      await acquireTransactionLock(transaction, `curriculum:${initial.courseId}`);
      await acquireTransactionLock(transaction, `batch:${id}`);

      const batch = await transaction.batch.findUnique({ where: { id } });
      const existingCount = await transaction.batchSession.count({
        where: { batchId: id },
      });
      if (existingCount > 0) {
        throw new ConflictError(
          "This batch already has a curriculum. Add individual sessions instead.",
        );
      }
      const initializedSessionCount = await copyActiveCurriculum(
        transaction,
        batch,
      );
      return { batchId: id, initializedSessionCount };
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function findSessions(batchId) {
  const [batchSessions, completions] = await Promise.all([
    prisma.batchSession.findMany({
      where: { batchId },
      orderBy: { orderIndex: "asc" },
      include: batchSessionInclude,
    }),
    prisma.sessionCompletion.findMany({
      where: { enrollment: { batchId } },
      select: { courseSessionId: true },
    }),
  ]);
  const completionCounts = completions.reduce((counts, completion) => {
    counts.set(
      completion.courseSessionId,
      (counts.get(completion.courseSessionId) ?? 0) + 1,
    );
    return counts;
  }, new Map());
  return batchSessions.map((batchSession) => ({
    ...batchSession,
    completionCount: completionCounts.get(batchSession.courseSessionId) ?? 0,
  }));
}

export async function findSession(batchId, courseSessionId) {
  return prisma.batchSession.findUnique({
    where: { batchId_courseSessionId: { batchId, courseSessionId } },
    include: batchSessionInclude,
  });
}

export async function upsertSession(
  batchId,
  courseSessionId,
  { orderIndex: requestedOrderIndex, isReleased, availableAt },
) {
  try {
    const batchSessionId = await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `batch:${batchId}`);
      await acquireTransactionLock(
        transaction,
        `course-session:${courseSessionId}`,
      );

      const [batch, courseSession, existing, ordered] = await Promise.all([
        transaction.batch.findUnique({ where: { id: batchId } }),
        transaction.courseSession.findUnique({ where: { id: courseSessionId } }),
        transaction.batchSession.findUnique({
          where: { batchId_courseSessionId: { batchId, courseSessionId } },
        }),
        transaction.batchSession.findMany({
          where: { batchId },
          orderBy: { orderIndex: "asc" },
          select: { id: true },
        }),
      ]);
      if (!batch) throw new NotFoundError("Batch not found.");
      if (!courseSession || courseSession.courseId !== batch.courseId) {
        throw new NotFoundError("Course session not found for this batch's course.");
      }
      if (!existing && courseSession.retiredAt) {
        throw new ConflictError("A retired curriculum session cannot be added to a batch.");
      }

      const currentIndex = existing
        ? ordered.findIndex(({ id }) => id === existing.id)
        : -1;
      const maxIndex = existing ? ordered.length - 1 : ordered.length;
      const orderIndex = requestedOrderIndex ?? (existing ? currentIndex : maxIndex);
      if (orderIndex < 0 || orderIndex > maxIndex) {
        throw new ValidationError(
          `Order index must be between 0 and ${maxIndex}.`,
          "orderIndex",
        );
      }

      const releaseData = {
        isReleased,
        availableAt: isReleased ? (availableAt ?? null) : null,
      };
      if (existing && orderIndex === currentIndex) {
        const updated = await transaction.batchSession.update({
          where: { id: existing.id },
          data: releaseData,
          select: { id: true },
        });
        return updated.id;
      }

      await moveBatchSessionsOutOfRange(transaction, batchId);
      const orderedIds = ordered
        .map(({ id }) => id)
        .filter((id) => id !== existing?.id);

      let id = existing?.id;
      if (!id) {
        const created = await transaction.batchSession.create({
          data: {
            batchId,
            courseSessionId,
            courseId: batch.courseId,
            orderIndex,
            ...releaseData,
          },
          select: { id: true },
        });
        id = created.id;
      }
      orderedIds.splice(orderIndex, 0, id);
      await assignBatchOrder(transaction, orderedIds);
      if (existing) {
        await transaction.batchSession.update({
          where: { id },
          data: releaseData,
        });
      }
      return id;
    });

    return await prisma.batchSession.findUnique({
      where: { id: batchSessionId },
      include: batchSessionInclude,
    });
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

export async function reorderSessions(batchId, orderedBatchSessions) {
  try {
    await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `batch:${batchId}`);
      const existing = await transaction.batchSession.findMany({
        where: { batchId },
        select: { id: true },
      });
      const expectedIds = new Set(existing.map(({ id }) => id));
      const suppliedIds = new Set(orderedBatchSessions.map(({ id }) => id));
      if (
        expectedIds.size !== suppliedIds.size ||
        [...suppliedIds].some((id) => !expectedIds.has(id))
      ) {
        throw new ValidationError(
          "Reordering must include every batch session exactly once.",
          "batchSessions",
        );
      }
      await moveBatchSessionsOutOfRange(transaction, batchId);
      await assignBatchOrder(
        transaction,
        [...orderedBatchSessions]
          .sort((left, right) => left.orderIndex - right.orderIndex)
          .map(({ id }) => id),
      );
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw handlePrismaError(error);
  }
}

export async function removeOrWithdrawSession(batchId, courseSessionId) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `batch:${batchId}`);
      const batchSession = await transaction.batchSession.findUnique({
        where: { batchId_courseSessionId: { batchId, courseSessionId } },
      });
      if (!batchSession) throw new NotFoundError("Batch session not found.");

      const completionCount = await transaction.sessionCompletion.count({
        where: { courseSessionId, enrollment: { batchId } },
      });
      if (batchSession.isReleased || completionCount > 0) {
        await transaction.batchSession.update({
          where: { id: batchSession.id },
          data: { isReleased: false, availableAt: null },
        });
        return { id: batchSession.id, action: "WITHDRAWN", completionCount };
      }

      const remaining = await transaction.batchSession.findMany({
        where: { batchId, id: { not: batchSession.id } },
        orderBy: { orderIndex: "asc" },
        select: { id: true },
      });
      await moveBatchSessionsOutOfRange(transaction, batchId);
      await transaction.batchSession.delete({ where: { id: batchSession.id } });
      await assignBatchOrder(
        transaction,
        remaining.map(({ id }) => id),
      );
      return { id: batchSession.id, action: "REMOVED", completionCount: 0 };
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

