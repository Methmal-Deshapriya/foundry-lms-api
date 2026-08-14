import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
  NotFoundError,
  handlePrismaError,
} from "../../../utils/Errors.js";
import {
  addDeletionSummary,
  assertDeletionAllowed,
  buildDeletionImpact,
  deleteCourseGraph,
  emptyDeletionSummary,
  lockArchivedCourses,
  runSerializableCatalogTransaction,
} from "./catalogDeletion.repository.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

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

export async function updateOperational(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `catalog-category:${id}`);
      const current = await transaction.category.findUnique({ where: { id } });
      if (!current) throw new NotFoundError("Category not found.");
      if (Object.hasOwn(data, "serviceType")) {
        throw new ConflictError(
          "A category's learning service is selected at creation and cannot be changed later.",
        );
      }
      if (current.status === "ARCHIVED") {
        throw new ConflictError("Archived categories cannot be edited.");
      }
      return transaction.category.update({
        where: { id },
        data,
        include: { _count: { select: { courses: true } } },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function setPublication(id, publish) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `catalog-category:${id}`);
      const current = await transaction.category.findUnique({ where: { id } });
      if (!current) throw new NotFoundError("Category not found.");
      if (current.status === "ARCHIVED") {
        throw new ConflictError("Archived categories cannot be published.");
      }
      return transaction.category.update({
        where: { id },
        data: { status: publish ? "PUBLISHED" : "DRAFT" },
        include: { _count: { select: { courses: true } } },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function restore(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `catalog-category:${id}`);
      const current = await transaction.category.findUnique({ where: { id } });
      if (!current) throw new NotFoundError("Category not found.");
      if (current.status !== "ARCHIVED") {
        throw new ConflictError("Only archived categories can be restored.");
      }
      return transaction.category.update({
        where: { id },
        data: { status: "DRAFT" },
        include: { _count: { select: { courses: true } } },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function archiveSafely(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `catalog-category:${id}`);
      const current = await transaction.category.findUnique({
        where: { id },
        select: {
          status: true,
          courses: { select: { id: true }, orderBy: { id: "asc" } },
        },
      });
      if (!current) return null;

      const courseIds = current.courses.map(({ id: courseId }) => courseId);
      for (const courseId of courseIds) {
        await acquireTransactionLock(transaction, `curriculum:${courseId}`);
      }
      const enrollingBatchCount =
        courseIds.length === 0
          ? 0
          : await transaction.batch.count({
              where: { courseId: { in: courseIds }, status: "ENROLLING" },
            });
      if (enrollingBatchCount > 0) {
        throw new ConflictError(
          "Cancel enrolling batches before archiving this category.",
          "CATALOG_ARCHIVE_BLOCKED",
        );
      }

      const archivedCourses = await transaction.course.updateMany({
        where: { categoryId: id, status: { not: "ARCHIVED" } },
        data: { status: "ARCHIVED" },
      });
      const category = await transaction.category.update({
        where: { id },
        data: { status: "ARCHIVED" },
        include: { _count: { select: { courses: true } } },
      });
      return { category, archivedCourseCount: archivedCourses.count };
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}

export async function findDeletionImpact(id) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      courses: { select: { id: true }, orderBy: { id: "asc" } },
    },
  });
  if (!category) return null;
  return buildDeletionImpact(prisma, {
    resourceType: "CATEGORY",
    resourceId: category.id,
    resourceStatus: category.status,
    courseIds: category.courses.map((course) => course.id),
  });
}

export async function removePermanently(id) {
  try {
    return await runSerializableCatalogTransaction(prisma, async (transaction) => {
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
      await lockArchivedCourses(transaction, courseIds);

      const impact = await buildDeletionImpact(transaction, {
        resourceType: "CATEGORY",
        resourceId: id,
        resourceStatus: "ARCHIVED",
        courseIds,
        sequential: true,
      });
      assertDeletionAllowed(impact);

      const summary = emptyDeletionSummary();
      for (const courseId of courseIds) {
        addDeletionSummary(
          summary,
          await deleteCourseGraph(transaction, courseId),
        );
      }

      await transaction.category.delete({ where: { id } });

      return {
        id,
        ...summary,
      };
    });
  } catch (error) {
    if (error instanceof ConflictError || error?.code === "CATALOG_DELETION_BLOCKED") {
      throw error;
    }
    throw handlePrismaError(error);
  }
}
