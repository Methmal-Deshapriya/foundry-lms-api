import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, SequenceRiskError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = {
  session: true,
  _count: { select: { completions: true } },
};

export function findById(id) { return prisma.courseSession.findUnique({ where: { id }, include }); }

export function findCurriculum(courseId, includeRetired = false) {
  return prisma.courseSession.findMany({
    where: { courseId, ...(includeRetired ? {} : { retiredAt: null }) },
    orderBy: [{ retiredAt: "asc" }, { orderIndex: "asc" }, { historicalOrderIndex: "asc" }],
    include,
  });
}

async function lockCourse(transaction, courseId) {
  const initial = await transaction.course.findUnique({
    where: { id: courseId },
    select: { categoryId: true, courseGroupId: true, category: { select: { serviceId: true } } },
  });
  if (!initial) throw new NotFoundError("Course not found.");
  await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
  await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
  await acquireTransactionLock(transaction, `course-group:${initial.courseGroupId}`);
  await acquireTransactionLock(transaction, `course:${courseId}`);
  const course = await transaction.course.findUnique({ where: { id: courseId }, include: { courseGroup: true, category: { include: { service: true } } } });
  if (!course) throw new NotFoundError("Course not found.");
  if (["COMPLETED", "CANCELLED", "ARCHIVED"].includes(course.status)) throw new ConflictError("Terminal courses have a frozen curriculum.");
  if (course.category.service.status === "ARCHIVED" || course.courseGroup.archivedAt || course.category.status === "ARCHIVED") throw new ConflictError("Archived catalog setup is read-only.");
  return course;
}

async function compact(transaction, courseId) {
  const active = await transaction.courseSession.findMany({ where: { courseId, retiredAt: null }, orderBy: { orderIndex: "asc" }, select: { id: true } });
  if (active.length === 0) return;
  await moveActiveOrderIndexesOutOfRange(transaction, courseId, active);
  for (const [orderIndex, item] of active.entries()) await transaction.courseSession.update({ where: { id: item.id }, data: { orderIndex } });
}

async function moveActiveOrderIndexesOutOfRange(transaction, courseId, active) {
  const maxOrderIndex = active.reduce(
    (maximum, item) => Math.max(maximum, item.orderIndex ?? 0),
    0,
  );
  const offset = maxOrderIndex + active.length + 1;
  await transaction.courseSession.updateMany({
    where: { courseId, retiredAt: null },
    data: { orderIndex: { increment: offset } },
  });
}

function isVisibleNow(item, now = new Date()) {
  return item.deliveryStatus === "RELEASED" ||
    (item.deliveryStatus === "SCHEDULED" && item.availableAt && item.availableAt <= now);
}

async function protectOpenFreeCurriculum(transaction, course, item, nextStatus = null, nextAvailableAt = null) {
  if (
    course.status !== "OPEN_ACTIVE" ||
    course.category.service.courseMode !== "EVERGREEN" ||
    course.category.service.accessType !== "FREE"
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
      courseId: course.id,
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
      "An open Free Learning course must keep at least one visible session. Close or cancel the course first.",
      "FREE_COURSE_REQUIRES_VISIBLE_SESSION",
    );
  }
}

export async function attach(courseId, sessionId, requestedIndex) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockCourse(transaction, courseId);
      const session = await transaction.session.findUnique({ where: { id: sessionId } });
      if (!session) throw new NotFoundError("Session not found.");
      if (session.status !== "READY") throw new ConflictError("Only Ready sessions can be attached.");
      const existing = await transaction.courseSession.findUnique({ where: { courseId_sessionId: { courseId, sessionId } } });
      if (existing && !existing.retiredAt) throw new ConflictError("Session is already attached to this course.");
      const active = await transaction.courseSession.findMany({ where: { courseId, retiredAt: null }, orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true } });
      const index = Math.min(requestedIndex ?? active.length, active.length);
      if (active.length > 0) await moveActiveOrderIndexesOutOfRange(transaction, courseId, active);
      let relation;
      if (existing) {
        relation = await transaction.courseSession.update({ where: { id: existing.id }, data: { retiredAt: null, historicalOrderIndex: null, orderIndex: index, deliveryStatus: "WITHDRAWN", availableAt: null } });
      } else {
        relation = await transaction.courseSession.create({ data: { courseId, sessionId, orderIndex: index } });
      }
      const ids = active.map(({ id }) => id);
      ids.splice(index, 0, relation.id);
      for (const [orderIndex, id] of ids.entries()) await transaction.courseSession.update({ where: { id }, data: { orderIndex } });
      return transaction.courseSession.findUnique({ where: { id: relation.id }, include });
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function reorder(courseId, items, acknowledgeSequenceRisk = false) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockCourse(transaction, courseId);
      const active = await transaction.courseSession.findMany({
        where: { courseId, retiredAt: null },
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
      if (active.length > 0) await moveActiveOrderIndexesOutOfRange(transaction, courseId, active);
      for (const item of items) await transaction.courseSession.update({ where: { id: item.id }, data: { orderIndex: item.orderIndex } });
      return true;
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function remove(courseId, courseSessionId) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const course = await lockCourse(transaction, courseId);
      const item = await transaction.courseSession.findFirst({ where: { id: courseSessionId, courseId, retiredAt: null }, include: { _count: { select: { completions: true } } } });
      if (!item) throw new NotFoundError("Course session not found.");
      await protectOpenFreeCurriculum(transaction, course, item);
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
      await compact(transaction, courseId);
      return { action: protectedHistory ? "RETIRED" : "DETACHED" };
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function updateDelivery(courseId, courseSessionId, input) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const course = await lockCourse(transaction, courseId);
      if (!["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(course.status)) throw new ConflictError("Session delivery is available only while the course is active.");
      const item = await transaction.courseSession.findFirst({ where: { id: courseSessionId, courseId, retiredAt: null }, include: { session: true } });
      if (!item) throw new NotFoundError("Course session not found.");
      if (["RELEASED", "SCHEDULED"].includes(input.status) && item.session.status !== "READY") throw new ConflictError("Archived sessions cannot be newly released or scheduled.");
      if (input.status === "SCHEDULED" && (!input.availableAt || input.availableAt <= new Date())) throw new ConflictError("Scheduled availability must be in the future.");
      await protectOpenFreeCurriculum(transaction, course, item, input.status, input.availableAt);
      const all = await transaction.courseSession.findMany({ where: { courseId, retiredAt: null }, orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true, deliveryStatus: true, availableAt: true, session: { select: { title: true } } } });
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
