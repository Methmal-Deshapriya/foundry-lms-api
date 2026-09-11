import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, SequenceRiskError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = {
  session: true,
  _count: { select: { completions: true } },
};

export function findById(id) { return prisma.courseSession.findUnique({ where: { id }, include }); }

export function findCurriculum(intakeId, includeRetired = false) {
  return prisma.courseSession.findMany({
    where: { intakeId, ...(includeRetired ? {} : { retiredAt: null }) },
    orderBy: [{ retiredAt: "asc" }, { orderIndex: "asc" }, { historicalOrderIndex: "asc" }],
    include,
  });
}

async function lockIntake(transaction, intakeId) {
  const initial = await transaction.intake.findUnique({
    where: { id: intakeId },
    select: { categoryId: true, courseId: true, category: { select: { serviceId: true } } },
  });
  if (!initial) throw new NotFoundError("Intake not found.");
  await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
  await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
  await acquireTransactionLock(transaction, `course:${initial.courseId}`);
  await acquireTransactionLock(transaction, `intake:${intakeId}`);
  const intake = await transaction.intake.findUnique({ where: { id: intakeId }, include: { course: true, category: { include: { service: true } } } });
  if (!intake) throw new NotFoundError("Intake not found.");
  if (["COMPLETED", "CANCELLED", "ARCHIVED"].includes(intake.status)) throw new ConflictError("Terminal intakes have a frozen curriculum.");
  if (intake.category.service.status === "ARCHIVED" || intake.course.archivedAt || intake.category.status === "ARCHIVED") throw new ConflictError("Archived catalog setup is read-only.");
  return intake;
}

async function compact(transaction, intakeId) {
  const active = await transaction.courseSession.findMany({ where: { intakeId, retiredAt: null }, orderBy: { orderIndex: "asc" }, select: { id: true } });
  if (active.length === 0) return;
  await moveActiveOrderIndexesOutOfRange(transaction, intakeId, active);
  for (const [orderIndex, item] of active.entries()) await transaction.courseSession.update({ where: { id: item.id }, data: { orderIndex } });
}

async function moveActiveOrderIndexesOutOfRange(transaction, intakeId, active) {
  const maxOrderIndex = active.reduce(
    (maximum, item) => Math.max(maximum, item.orderIndex ?? 0),
    0,
  );
  const offset = maxOrderIndex + active.length + 1;
  await transaction.courseSession.updateMany({
    where: { intakeId, retiredAt: null },
    data: { orderIndex: { increment: offset } },
  });
}

function isVisibleNow(item, now = new Date()) {
  return item.deliveryStatus === "RELEASED" ||
    (item.deliveryStatus === "SCHEDULED" && item.availableAt && item.availableAt <= now);
}

async function protectOpenFreeCurriculum(transaction, intake, item, nextStatus = null, nextAvailableAt = null) {
  if (
    intake.status !== "OPEN_ACTIVE" ||
    intake.category.service.courseMode !== "EVERGREEN" ||
    intake.category.service.accessType !== "FREE"
  ) {
    return;
  }
  const currentlyVisible = isVisibleNow(item);
  const remainsVisible = nextStatus
    ? isVisibleNow({ deliveryStatus: nextStatus, availableAt: nextAvailableAt })
    : false;
  if (!currentlyVisible || remainsVisible) return;
  const otherVisibleCount = await transaction.courseSession.count({
    where: {
      intakeId: intake.id,
      id: { not: item.id },
      retiredAt: null,
      OR: [
        { deliveryStatus: "RELEASED" },
        { deliveryStatus: "SCHEDULED", availableAt: { lte: new Date() } },
      ],
    },
  });
  if (otherVisibleCount === 0) {
    throw new ConflictError(
      "An open Free Learning intake must keep at least one visible session. Close or cancel the intake first.",
      "FREE_INTAKE_REQUIRES_VISIBLE_SESSION",
    );
  }
}

export async function attach(intakeId, sessionId, requestedIndex) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockIntake(transaction, intakeId);
      const session = await transaction.session.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundError("Session not found.");
      if (session.status !== "READY") throw new ConflictError("Only Ready sessions can be attached.");
      const existing = await transaction.courseSession.findUnique({ where: { intakeId_sessionId: { intakeId, sessionId } } });
      if (existing && !existing.retiredAt) throw new ConflictError("Session is already attached to this intake.");
      const active = await transaction.courseSession.findMany({ where: { intakeId, retiredAt: null }, orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true } });
      const index = Math.min(requestedIndex ?? active.length, active.length);
      if (active.length > 0) await moveActiveOrderIndexesOutOfRange(transaction, intakeId, active);
      let relation;
      if (existing) {
        relation = await transaction.courseSession.update({ where: { id: existing.id }, data: { retiredAt: null, historicalOrderIndex: null, orderIndex: index, deliveryStatus: "WITHDRAWN", availableAt: null } });
      } else {
        relation = await transaction.courseSession.create({ data: { intakeId, sessionId, orderIndex: index } });
      }
      const ids = active.map(({ id }) => id);
      ids.splice(index, 0, relation.id);
      for (const [orderIndex, id] of ids.entries()) await transaction.courseSession.update({ where: { id }, data: { orderIndex } });
      return transaction.courseSession.findUnique({ where: { id: relation.id }, include });
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function reorder(intakeId, items, acknowledgeSequenceRisk = false) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockIntake(transaction, intakeId);
      const active = await transaction.courseSession.findMany({
        where: { intakeId, retiredAt: null },
        select: {
          id: true,
          orderIndex: true,
          deliveryStatus: true,
          firstReleasedAt: true,
          _count: { select: { completions: true } },
          session: { select: { title: true } },
        },
      });
      const expected = new Set(active.map(({ id }) => id));
      if (items.length !== expected.size || items.some(({ id }) => !expected.has(id))) throw new ConflictError("Reorder must include every active course session exactly once.");
      const nextOrder = new Map(items.map(({ id, orderIndex }) => [id, orderIndex]));
      const affected = active.filter((item) =>
        item.orderIndex !== nextOrder.get(item.id) &&
        (
          Boolean(item.firstReleasedAt) ||
          ["RELEASED", "SCHEDULED"].includes(item.deliveryStatus) ||
          item._count.completions > 0
        ),
      );
      if (affected.length > 0 && !acknowledgeSequenceRisk) {
        throw new SequenceRiskError(
          "Reordering changes the position of sessions already scheduled, released, or completed.",
          {
            blockingSessions: affected.map((item) => ({
              id: item.id,
              title: item.session.title,
              orderIndex: item.orderIndex,
              requestedOrderIndex: nextOrder.get(item.id),
              deliveryStatus: item.deliveryStatus,
              completionCount: item._count.completions,
            })),
          },
        );
      }
      if (active.length > 0) await moveActiveOrderIndexesOutOfRange(transaction, intakeId, active);
      for (const item of items) await transaction.courseSession.update({ where: { id: item.id }, data: { orderIndex: item.orderIndex } });
      return true;
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function remove(intakeId, courseSessionId) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const intake = await lockIntake(transaction, intakeId);
      const item = await transaction.courseSession.findFirst({ where: { id: courseSessionId, intakeId, retiredAt: null }, include: { _count: { select: { completions: true } } } });
      if (!item) throw new NotFoundError("Course session not found.");
      await protectOpenFreeCurriculum(transaction, intake, item);
      const protectedHistory =
        Boolean(item.firstReleasedAt) ||
        item.deliveryStatus === "RELEASED" ||
        (item.deliveryStatus === "SCHEDULED" && item.availableAt && item.availableAt <= new Date()) ||
        item._count.completions > 0;
      if (protectedHistory) {
        // Retirement removes the item from the live curriculum but preserves the
        // delivery state learners already received. CourseSession is now the
        // delivery record, so withdrawing here would destroy historical access.
        await transaction.courseSession.update({
          where: { id: item.id },
          data: {
            historicalOrderIndex: item.orderIndex,
            orderIndex: null,
            retiredAt: new Date(),
          },
        });
      } else {
        await transaction.courseSession.delete({ where: { id: item.id } });
      }
      await compact(transaction, intakeId);
      return { action: protectedHistory ? "RETIRED" : "DETACHED" };
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function updateDelivery(intakeId, courseSessionId, input) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const intake = await lockIntake(transaction, intakeId);
      if (!["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(intake.status)) throw new ConflictError("Session delivery is available only while the intake is active.");
      const item = await transaction.courseSession.findFirst({ where: { id: courseSessionId, intakeId, retiredAt: null }, include: { session: true } });
      if (!item) throw new NotFoundError("Course session not found.");
      if (["RELEASED", "SCHEDULED"].includes(input.status) && item.session.status !== "READY") throw new ConflictError("Archived sessions cannot be newly released or scheduled.");
      if (input.status === "SCHEDULED" && (!input.availableAt || input.availableAt <= new Date())) throw new ConflictError("Scheduled availability must be in the future.");
      await protectOpenFreeCurriculum(transaction, intake, item, input.status, input.availableAt);
      const all = await transaction.courseSession.findMany({ where: { intakeId, retiredAt: null }, orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true, deliveryStatus: true, availableAt: true, session: { select: { title: true } } } });
      const now = new Date();
      const isAvailableBy = (row, boundary) =>
        row.deliveryStatus === "RELEASED" ||
        (row.deliveryStatus === "SCHEDULED" && row.availableAt && row.availableAt <= boundary);
      const releaseBoundary = input.status === "SCHEDULED" ? input.availableAt : now;
      const blockers = input.status === "RELEASED" || input.status === "SCHEDULED"
        ? all.filter((row) => row.orderIndex < item.orderIndex && !isAvailableBy(row, releaseBoundary))
        : input.status === "WITHDRAWN"
          ? all.filter((row) => row.orderIndex > item.orderIndex && ["RELEASED", "SCHEDULED"].includes(row.deliveryStatus))
          : [];
      if (blockers.length > 0 && !input.acknowledgeSequenceRisk) throw new SequenceRiskError("This delivery change breaks curriculum sequence.", { blockingSessions: blockers.map(({ id, session, orderIndex }) => ({ id, title: session.title, orderIndex })) });
      const firstReleasedAt = input.status === "RELEASED"
        ? item.firstReleasedAt ?? new Date()
        : item.firstReleasedAt;
      return transaction.courseSession.update({
        where: { id: item.id },
        data: { deliveryStatus: input.status, availableAt: input.status === "SCHEDULED" ? input.availableAt : null, firstReleasedAt },
        include,
      });
    });
  } catch (error) { if (error instanceof SequenceRiskError) throw error; throw handlePrismaError(error); }
}
