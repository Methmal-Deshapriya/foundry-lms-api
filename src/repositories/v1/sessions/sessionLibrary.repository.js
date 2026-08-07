import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
  handlePrismaError,
} from "../../../utils/Errors.js";

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

export async function update(id, data) {
  try {
    return await prisma.session.update({
      where: { id },
      data,
      include: usageInclude,
    });
  } catch (error) {
    throw handlePrismaError(error);
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

