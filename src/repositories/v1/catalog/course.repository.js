import prisma from "../../../utils/prisma.js";
import { ConflictError, handlePrismaError } from "../../../utils/Errors.js";

export async function findPublicDetail(serviceType, categorySlug, courseSlug) {
  return prisma.course.findFirst({
    where: {
      slug: courseSlug,
      status: "PUBLISHED",
      category: {
        serviceType,
        slug: categorySlug,
        status: "PUBLISHED",
      },
    },
    include: {
      category: {
        include: {
          courses: {
            where: { status: "PUBLISHED" },
            select: { level: true },
          },
          _count: {
            select: { courses: { where: { status: "PUBLISHED" } } },
          },
        },
      },
    },
  });
}

export async function findById(id) {
  return prisma.course.findUnique({
    where: { id },
    include: {
      category: true,
      _count: { select: { sessions: true, enrollments: true } },
    },
  });
}

export async function findPublishedFreeById(id) {
  return prisma.course.findFirst({
    where: {
      id,
      status: "PUBLISHED",
      accessType: "FREE",
      category: { status: "PUBLISHED" },
    },
    include: { category: true },
  });
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.accessType ? { accessType: filters.accessType } : {}),
    ...(filters.serviceType
      ? { category: { serviceType: filters.serviceType } }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { slug: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      orderBy: [
        { category: { serviceType: "asc" } },
        { category: { sortOrder: "asc" } },
        { sortOrder: "asc" },
        { title: "asc" },
      ],
      take: limit,
      skip: offset,
      include: {
        category: true,
        _count: { select: { sessions: true, enrollments: true } },
      },
    }),
  ]);

  return { total, courses };
}

export async function create(data) {
  try {
    return await prisma.course.create({
      data,
      include: {
        category: true,
        _count: { select: { sessions: true, enrollments: true } },
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.course.update({
      where: { id },
      data,
      include: {
        category: true,
        _count: { select: { sessions: true, enrollments: true } },
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function removePermanently(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const locked = await transaction.course.updateMany({
        where: { id, status: "ARCHIVED" },
        data: { status: "ARCHIVED" },
      });
      if (locked.count !== 1) {
        throw new ConflictError(
          "Only archived courses can be permanently deleted.",
        );
      }

      const deletedProjects = (
        await transaction.studentProject.deleteMany({ where: { courseId: id } })
      ).count;
      // Enrollment cascades remove certificates and session completions.
      const deletedEnrollments = (
        await transaction.enrollment.deleteMany({ where: { courseId: id } })
      ).count;
      const deletedSessions = (
        await transaction.session.deleteMany({ where: { courseId: id } })
      ).count;
      await transaction.course.delete({ where: { id } });

      return {
        id,
        deletedCourses: 1,
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
