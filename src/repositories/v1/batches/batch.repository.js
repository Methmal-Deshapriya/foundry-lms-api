import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import {
  ConflictError,
  NotFoundError,
  SequenceRiskError,
  handlePrismaError,
} from "../../../utils/Errors.js";

const LIVE_BATCH_STATUSES = ["DRAFT", "ENROLLING", "ACTIVE"];

const batchInclude = {
  course: {
    include: {
      category: true,
      _count: {
        select: {
          courseSessions: { where: { retiredAt: null } },
        },
      },
    },
  },
  _count: { select: { enrollments: true } },
};

function isCommitted(delivery) {
  return Boolean(delivery?.isReleased);
}

export function sequenceRiskDetails(
  curriculum,
  deliveries,
  courseSessionId,
  mode,
) {
  const targetIndex = curriculum.findIndex(({ id }) => id === courseSessionId);
  if (targetIndex < 0) return null;

  const effectiveCommitted = (item, index) => {
    if (index === targetIndex) return mode !== "UNRELEASED";
    return isCommitted(deliveries.get(item.id));
  };

  if (mode !== "UNRELEASED") {
    const blockers = curriculum
      .slice(0, targetIndex)
      .filter((item, index) => !effectiveCommitted(item, index))
      .map(({ id, orderIndex, session }) => ({
        courseSessionId: id,
        orderIndex,
        title: session.title,
        state: deliveries.has(id) ? "WITHDRAWN" : "UNRELEASED",
      }));
    if (blockers.length > 0) {
      return {
        warningCode: "EARLIER_SESSIONS_UNRELEASED",
        operation: mode,
        targetCourseSessionId: courseSessionId,
        conflicts: blockers,
        confirmationText: "CONFIRM",
      };
    }
    return null;
  }

  const laterCommitted = curriculum
    .slice(targetIndex + 1)
    .filter((item, offset) => effectiveCommitted(item, targetIndex + 1 + offset))
    .map(({ id, orderIndex, session }) => ({
      courseSessionId: id,
      orderIndex,
      title: session.title,
      state: deliveries.get(id)?.availableAt ? "SCHEDULED" : "RELEASED",
    }));
  if (laterCommitted.length === 0) return null;
  return {
    warningCode: "LATER_SESSIONS_ALREADY_COMMITTED",
    operation: mode,
    targetCourseSessionId: courseSessionId,
    conflicts: laterCommitted,
    confirmationText: "CONFIRM",
  };
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

export async function create(courseId, data) {
  try {
    return await prisma.batch.create({
      data: { ...data, courseId },
      include: batchInclude,
    });
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

async function freezeDeliveryHistoryInTransaction(transaction, batchId) {
  await transaction.$executeRaw`
    UPDATE "batch_sessions" AS delivery
    SET "historical_order_index" = course_session."order_index"
    FROM "course_sessions" AS course_session
    WHERE delivery."batch_id" = ${batchId}
      AND delivery."course_session_id" = course_session."id"
      AND delivery."historical_order_index" IS NULL
  `;
}

export async function findSessions(batchId) {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { id: true, courseId: true, status: true },
  });
  if (!batch) throw new NotFoundError("Batch not found.");

  const isLive = LIVE_BATCH_STATUSES.includes(batch.status);
  const curriculum = await prisma.courseSession.findMany({
    where: {
      courseId: batch.courseId,
      ...(isLive
        ? {
            OR: [
              { retiredAt: null },
              { batchLinks: { some: { batchId } } },
            ],
          }
        : { batchLinks: { some: { batchId } } }),
    },
    include: {
      session: true,
      batchLinks: { where: { batchId }, take: 1 },
      _count: {
        select: {
          completions: { where: { enrollment: { batchId } } },
        },
      },
    },
  });

  return curriculum
    .map((courseSession) => {
      const delivery = courseSession.batchLinks[0] ?? null;
      const active = courseSession.retiredAt == null;
      const orderIndex =
        isLive && active
          ? courseSession.orderIndex
          : delivery?.historicalOrderIndex ?? courseSession.orderIndex;
      return {
        id: delivery?.id ?? null,
        batchId,
        courseId: batch.courseId,
        courseSessionId: courseSession.id,
        orderIndex,
        historicalOrderIndex: delivery?.historicalOrderIndex ?? null,
        isReleased: delivery?.isReleased ?? false,
        availableAt: delivery?.availableAt ?? null,
        inherited: delivery == null,
        source: active ? "ACTIVE_CURRICULUM" : "RETAINED_HISTORY",
        completionCount: courseSession._count.completions,
        courseSession: {
          ...courseSession,
          batchLinks: undefined,
          _count: undefined,
        },
      };
    })
    .sort((left, right) => {
      const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
}

export async function findSession(batchId, courseSessionId) {
  const sessions = await findSessions(batchId);
  return sessions.find((session) => session.courseSessionId === courseSessionId) ?? null;
}

export async function updateDelivery(
  batchId,
  courseSessionId,
  { mode, availableAt, acknowledgeSequenceRisk },
) {
  try {
    await prisma.$transaction(async (transaction) => {
      const initialBatch = await transaction.batch.findUnique({
        where: { id: batchId },
        select: { courseId: true },
      });
      if (!initialBatch) throw new NotFoundError("Batch not found.");

      await acquireTransactionLock(
        transaction,
        `curriculum:${initialBatch.courseId}`,
      );
      await acquireTransactionLock(transaction, `batch:${batchId}`);

      const [batch, courseSession, curriculum, existingDeliveries] =
        await Promise.all([
          transaction.batch.findUnique({
            where: { id: batchId },
            select: { id: true, courseId: true, status: true },
          }),
          transaction.courseSession.findUnique({
            where: { id: courseSessionId },
          }),
          transaction.courseSession.findMany({
            where: { courseId: initialBatch.courseId, retiredAt: null },
            orderBy: { orderIndex: "asc" },
            select: {
              id: true,
              orderIndex: true,
              session: { select: { title: true } },
            },
          }),
          transaction.batchSession.findMany({
            where: { batchId },
          }),
        ]);

      const existing = existingDeliveries.find(
        (delivery) => delivery.courseSessionId === courseSessionId,
      );
      if (
        !courseSession ||
        courseSession.courseId !== batch.courseId ||
        (courseSession.retiredAt && !existing)
      ) {
        throw new NotFoundError("Course session is not part of this batch curriculum.");
      }

      if (!courseSession.retiredAt) {
        const deliveries = new Map(
          existingDeliveries.map((delivery) => [
            delivery.courseSessionId,
            delivery,
          ]),
        );
        const risk = sequenceRiskDetails(
          curriculum,
          deliveries,
          courseSessionId,
          mode,
        );
        if (risk && !acknowledgeSequenceRisk) {
          throw new SequenceRiskError(
            "This delivery change would break the curriculum release sequence.",
            risk,
          );
        }
      }

      if (mode === "UNRELEASED" && !existing) return;

      const deliveryData = {
        isReleased: mode !== "UNRELEASED",
        availableAt: mode === "SCHEDULED" ? availableAt : null,
      };
      if (existing) {
        await transaction.batchSession.update({
          where: { id: existing.id },
          data: deliveryData,
        });
        return;
      }
      await transaction.batchSession.create({
        data: {
          batchId,
          courseSessionId,
          courseId: batch.courseId,
          ...deliveryData,
        },
      });
    });

    return await findSession(batchId, courseSessionId);
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof NotFoundError ||
      error instanceof SequenceRiskError
    ) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

async function calculateCompletionReadiness(client, batchId, now = new Date()) {
  const batch = await client.batch.findUnique({
    where: { id: batchId },
    select: {
      courseId: true,
      status: true,
      course: { select: { certificateEnabled: true } },
    },
  });
  if (!batch) throw new NotFoundError("Batch not found.");

  const enrollmentWhere = { batchId, status: { not: "CANCELLED" } };
  const liveCurriculum = LIVE_BATCH_STATUSES.includes(batch.status);
  const [curriculumCount, releasedCount, enrollmentCount, completedCount, certificateCount] =
    await Promise.all([
      liveCurriculum
        ? client.courseSession.count({
            where: { courseId: batch.courseId, retiredAt: null },
          })
        : client.batchSession.count({ where: { batchId } }),
      liveCurriculum
        ? client.courseSession.count({
            where: {
              courseId: batch.courseId,
              retiredAt: null,
              batchLinks: {
                some: {
                  batchId,
                  isReleased: true,
                  OR: [{ availableAt: null }, { availableAt: { lte: now } }],
                },
              },
            },
          })
        : client.batchSession.count({
            where: {
              batchId,
              isReleased: true,
              OR: [{ availableAt: null }, { availableAt: { lte: now } }],
            },
          }),
      client.enrollment.count({ where: enrollmentWhere }),
      client.enrollment.count({
        where: { ...enrollmentWhere, status: "COMPLETED" },
      }),
      batch.course.certificateEnabled
        ? client.certificate.count({
            where: {
              status: "ISSUED",
              enrollment: enrollmentWhere,
            },
          })
        : 0,
    ]);

  return {
    curriculum: {
      total: curriculumCount,
      releasedAndAvailable: releasedCount,
      ready: curriculumCount > 0 && curriculumCount === releasedCount,
    },
    enrollments: {
      total: enrollmentCount,
      completed: completedCount,
      ready: enrollmentCount === completedCount,
    },
    certificates: {
      required: batch.course.certificateEnabled,
      enabled: batch.course.certificateEnabled,
      issued: certificateCount,
      ready:
        !batch.course.certificateEnabled || certificateCount === enrollmentCount,
    },
  };
}

export async function findCompletionReadiness(batchId, now = new Date()) {
  return calculateCompletionReadiness(prisma, batchId, now);
}

export async function transitionStatus(
  batchId,
  expectedStatus,
  nextStatus,
  { requireCompletionReadiness = false } = {},
) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const initial = await transaction.batch.findUnique({
        where: { id: batchId },
        select: { courseId: true },
      });
      if (!initial) throw new NotFoundError("Batch not found.");
      await acquireTransactionLock(transaction, `curriculum:${initial.courseId}`);
      await acquireTransactionLock(transaction, `batch:${batchId}`);

      const current = await transaction.batch.findUnique({
        where: { id: batchId },
        select: { status: true },
      });
      if (current.status !== expectedStatus) {
        throw new ConflictError(
          "The batch status changed while this request was being processed. Refresh and try again.",
        );
      }

      let completionReadiness = null;
      if (requireCompletionReadiness) {
        completionReadiness = await calculateCompletionReadiness(
          transaction,
          batchId,
        );
        const ready =
          completionReadiness.curriculum.ready &&
          completionReadiness.enrollments.ready &&
          completionReadiness.certificates.ready;
        if (!ready) {
          const certificateWork = completionReadiness.certificates.required
            ? " and issue certificates for every non-cancelled enrollment"
            : "";
          const error = new ConflictError(
            `This batch is not ready to complete. Release the full curriculum, complete every non-cancelled enrollment${certificateWork} first.`,
          );
          error.details = completionReadiness;
          throw error;
        }
      }

      if (
        ["COMPLETED", "CANCELLED", "ARCHIVED"].includes(nextStatus) &&
        LIVE_BATCH_STATUSES.includes(expectedStatus)
      ) {
        await freezeDeliveryHistoryInTransaction(transaction, batchId);
      }
      await transaction.batch.update({
        where: { id: batchId },
        data: { status: nextStatus },
      });
      return { completionReadiness };
    });
    return { batch: await findById(batchId), ...result };
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}
