import prisma from "../../../utils/prisma.js";
import { handlePrismaError, ValidationError } from "../../../utils/Errors.js";

export async function findByCourseIdAdmin(courseId) {
  return prisma.session.findMany({
    where: { courseId },
    orderBy: { orderIndex: "asc" },
  });
}

export async function findByCourseIdPublic(courseId) {
  return prisma.session.findMany({
    where: { courseId, isPublished: true },
    orderBy: { orderIndex: "asc" },
  });
}

export async function findById(id) {
  return prisma.session.findUnique({ where: { id } });
}

export async function create(courseId, data) {
  try {
    return await prisma.session.create({ data: { ...data, courseId } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.session.update({ where: { id }, data });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function remove(id) {
  try {
    return await prisma.session.delete({ where: { id } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function reorder(courseId, orderedSessions) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const courseSessions = await transaction.session.findMany({
        where: { courseId },
        select: { id: true },
      });

      const expectedIds = new Set(courseSessions.map(({ id }) => id));
      const suppliedIds = new Set(orderedSessions.map(({ id }) => id));
      if (
        expectedIds.size !== suppliedIds.size ||
        [...suppliedIds].some((id) => !expectedIds.has(id))
      ) {
        throw new ValidationError(
          "Reordering must include every session in this course exactly once.",
          "sessions"
        );
      }

      // Move all indexes out of the valid range before assigning their final
      // positions, avoiding collisions with the per-course unique constraint.
      await transaction.session.updateMany({
        where: { courseId },
        data: { orderIndex: { increment: 1_000_000 } },
      });
      await Promise.all(
        orderedSessions.map(({ id, orderIndex }) =>
          transaction.session.update({ where: { id }, data: { orderIndex } })
        )
      );
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw handlePrismaError(error);
  }
}

export async function countPublishedByCourse(courseId) {
  return prisma.session.count({ where: { courseId, isPublished: true } });
}
