import prisma from "../../../utils/prisma.js";
import { ConflictError, handlePrismaError } from "../../../utils/Errors.js";

export async function findPublicByService(serviceType) {
  return prisma.category.findMany({
    where: { serviceType, status: "PUBLISHED" },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: {
      courses: {
        where: { status: "PUBLISHED" },
        select: { level: true },
      },
      _count: {
        select: { courses: { where: { status: "PUBLISHED" } } },
      },
    },
  });
}

export async function findPublicBySlug(serviceType, slug) {
  return prisma.category.findFirst({
    where: { serviceType, slug, status: "PUBLISHED" },
    include: {
      courses: {
        where: { status: "PUBLISHED" },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      },
      _count: {
        select: { courses: { where: { status: "PUBLISHED" } } },
      },
    },
  });
}

export async function findById(id) {
  return prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { courses: true } } },
  });
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.serviceType ? { serviceType: filters.serviceType } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { slug: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, categories] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      orderBy: [{ serviceType: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
      take: limit,
      skip: offset,
      include: { _count: { select: { courses: true } } },
    }),
  ]);

  return { total, categories };
}

export async function create(data) {
  try {
    return await prisma.category.create({ data });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.category.update({
      where: { id },
      data,
      include: { _count: { select: { courses: true } } },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function archive(id) {
  return prisma.$transaction([
    prisma.course.updateMany({
      where: { categoryId: id, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    }),
    prisma.category.update({
      where: { id },
      data: { status: "ARCHIVED" },
      include: { _count: { select: { courses: true } } },
    }),
  ]);
}

export async function removePermanently(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      // The no-op conditional update locks the archived category row and
      // prevents an unarchive request from racing this destructive operation.
      const locked = await transaction.category.updateMany({
        where: { id, status: "ARCHIVED" },
        data: { status: "ARCHIVED" },
      });
      if (locked.count !== 1) {
        throw new ConflictError(
          "Only archived categories can be permanently deleted.",
        );
      }

      const courses = await transaction.course.findMany({
        where: { categoryId: id },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      const courseIds = courses.map((course) => course.id);

      let deletedProjects = 0;
      let deletedEnrollments = 0;
      let deletedSessions = 0;
      let deletedCourses = 0;

      if (courseIds.length > 0) {
        // Keep this order consistent with course deletion and satisfy the
        // restrictive historical foreign keys without broad schema cascades.
        deletedProjects = (
          await transaction.studentProject.deleteMany({
            where: { courseId: { in: courseIds } },
          })
        ).count;
        deletedEnrollments = (
          await transaction.enrollment.deleteMany({
            where: { courseId: { in: courseIds } },
          })
        ).count;
        deletedSessions = (
          await transaction.session.deleteMany({
            where: { courseId: { in: courseIds } },
          })
        ).count;
        deletedCourses = (
          await transaction.course.deleteMany({
            where: { id: { in: courseIds } },
          })
        ).count;
      }

      await transaction.category.delete({ where: { id } });

      return {
        id,
        deletedCourses,
        deletedSessions,
        deletedEnrollments,
        deletedProjects,
      };
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}
