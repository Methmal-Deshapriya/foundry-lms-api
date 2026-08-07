import prisma from "../../../utils/prisma.js";
import { ConflictError, handlePrismaError } from "../../../utils/Errors.js";
import { deleteCourseGraph } from "./catalogDeletion.repository.js";

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
      _count: {
        select: {
          courseSessions: { where: { retiredAt: null } },
          batches: true,
          enrollments: true,
        },
      },
    },
  });
}

export async function findPublishedFreeById(id) {
  return prisma.course.findFirst({
    where: {
      id,
      status: "PUBLISHED",
      accessType: "FREE",
      category: { status: "PUBLISHED", serviceType: "FREE_LEARNING" },
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
        _count: {
          select: {
            courseSessions: { where: { retiredAt: null } },
            batches: true,
            enrollments: true,
          },
        },
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
        _count: {
          select: {
            courseSessions: { where: { retiredAt: null } },
            batches: true,
            enrollments: true,
          },
        },
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
        _count: {
          select: {
            courseSessions: { where: { retiredAt: null } },
            batches: true,
            enrollments: true,
          },
        },
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function removePermanently(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const result = await deleteCourseGraph(transaction, id);
      return { id, ...result };
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}
