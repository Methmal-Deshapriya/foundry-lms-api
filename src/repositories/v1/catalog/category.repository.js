import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

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
