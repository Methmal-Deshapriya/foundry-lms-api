import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  handlePrismaError,
} from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import { hasLearningAccess } from "../../../utils/enrollmentAccessPolicy.js";

/**
 * Student Project Repository
 */

export async function findById(id) {
  return await prisma.studentProject.findUnique({
    where: { id },
    include: {
      user: true,
      intake: { include: { course: true } },
      enrollment: true,
    },
  });
}

const publicProjectSelect = {
  id: true,
  title: true,
  description: true,
  thumbnailUrl: true,
  projectUrl: true,
  githubUrl: true,
  demoUrl: true,
  technologies: true,
  status: true,
  isPublic: true,
  displayOrder: true,
  likeCount: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { firstName: true, lastName: true } },
  intake: { select: { course: { select: { title: true } } } },
};

export async function findPublicById(id) {
  return prisma.studentProject.findFirst({
    where: { id, status: "APPROVED", isPublic: true },
    select: publicProjectSelect,
  });
}

function pageResult(rows, limit) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items.at(-1).id : null };
}

export async function findByUserId(userId, { limit, cursor }) {
  const rows = await prisma.studentProject.findMany({
    where: { userId },
    include: {
      intake: { include: { course: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return pageResult(rows, limit);
}

function projectSharedWhere({ q = "", intakeId }) {
  return {
    ...(intakeId ? { intakeId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { user: { firstName: { contains: q, mode: "insensitive" } } },
            { user: { lastName: { contains: q, mode: "insensitive" } } },
            { user: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

// Two pagination modes, same shape as certificate.repository.js: cursor
// (the global /admin/projects page) or offset (the intake workspace's
// Projects tab — pass `offset` as a number, including 0, to select it).
export async function findAllAdmin({ q = "", limit, cursor, offset = null, intakeId, status }) {
  const sharedWhere = projectSharedWhere({ q, intakeId });
  const where = { ...sharedWhere, ...(status ? { status } : {}) };
  const statusCounts = await prisma.studentProject.groupBy({ by: ["status"], where: sharedWhere, _count: true });

  if (offset != null) {
    const [total, projects] = await Promise.all([
      prisma.studentProject.count({ where }),
      prisma.studentProject.findMany({
        where,
        include: { user: true, intake: { include: { course: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        skip: offset,
      }),
    ]);
    return { mode: "offset", items: projects, total, statusCounts };
  }

  const rows = await prisma.studentProject.findMany({
    where,
    include: { user: true, intake: { include: { course: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return { mode: "cursor", ...pageResult(rows, limit), statusCounts };
}

export async function findPublicShowcase({ limit, cursor }) {
  const rows = await prisma.studentProject.findMany({
    where: {
      status: "APPROVED",
      isPublic: true,
    },
    select: publicProjectSelect,
    orderBy: [
      { likeCount: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  return pageResult(rows, limit);
}

export async function updatePendingOwned(id, userId, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `project:${id}`);
      const current = await transaction.studentProject.findUnique({
        where: { id },
        select: { id: true, userId: true, status: true },
      });
      if (!current) throw new NotFoundError("Project not found.");
      if (current.userId !== userId) {
        throw new ForbiddenError("You can only edit your own projects.");
      }
      if (current.status !== "PENDING") {
        throw new ConflictError(
          "This project was reviewed while you were editing it. Only pending projects can be changed.",
          "PROJECT_REVIEW_STATE_CHANGED",
        );
      }
      return transaction.studentProject.update({ where: { id }, data });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function review(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `project:${id}`);
      const current = await transaction.studentProject.findUnique({
        where: { id },
        select: { id: true, title: true },
      });
      if (!current) throw new NotFoundError("Project not found.");
      const project = await transaction.studentProject.update({
        where: { id },
        data,
      });
      return { project, previous: current };
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function createForEnrollment(requester, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.enrollment.findUnique({
        where: { id: data.enrollmentId },
        select: {
          intakeId: true,
          intake: { select: { category: { select: { serviceId: true } } } },
        },
      });
      if (!initial) throw new NotFoundError("Enrollment not found.");
      await acquireTransactionLock(
        transaction,
        `learning-service:${initial.intake.category.serviceId}`,
      );
      await acquireTransactionLock(transaction, `intake:${initial.intakeId}`);
      await acquireTransactionLock(
        transaction,
        `enrollment:${data.enrollmentId}`,
      );

      const user = await transaction.user.findUnique({
        where: { id: requester.id },
        select: { id: true, role: true, emailVerified: true },
      });
      const enrollment = await transaction.enrollment.findUnique({
        where: { id: data.enrollmentId },
        include: {
          intake: { include: { category: { include: { service: true } } } },
        },
      });
      if (!user || user.role !== "STUDENT" || !user.emailVerified) {
        throw new ForbiddenError(
          "Only a currently verified student can submit a project.",
        );
      }
      if (
        !enrollment ||
        enrollment.userId !== requester.id ||
        enrollment.intakeId !== data.intakeId ||
        !["ACTIVE", "COMPLETED"].includes(enrollment.status)
      ) {
        throw new ForbiddenError(
          "The selected enrollment does not allow this project submission.",
        );
      }
      if (!["OPEN_ACTIVE", "CLOSED_ACTIVE", "COMPLETED", "ARCHIVED"].includes(enrollment.intake.status)) {
        throw new ForbiddenError("The selected intake does not currently allow project submission.");
      }
      if (!hasLearningAccess(enrollment, enrollment.intake.category.service)) {
        throw new ForbiddenError(
          "The selected enrollment does not have valid learning access.",
        );
      }

      return transaction.studentProject.create({ data });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.studentProject.update({
      where: { id },
      data,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function remove(id) {
  try {
    return await prisma.studentProject.delete({
      where: { id },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
