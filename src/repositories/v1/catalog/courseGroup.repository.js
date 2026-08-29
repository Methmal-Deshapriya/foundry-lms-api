import prisma from "../../../utils/prisma.js";
import { ConflictError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = {
  category: { include: { service: true } },
  courses: {
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    include: {
      category: true,
      courseGroup: true,
      _count: { select: { courseSessions: true, enrollments: true, studentProjects: true } },
    },
  },
  _count: { select: { courses: true } },
};

export function findById(id) {
  return prisma.courseGroup.findUnique({ where: { id }, include });
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.serviceId ? { category: { serviceId: filters.serviceId } } : {}),
    ...(!filters.includeArchived ? { archivedAt: null } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { slug: { contains: filters.q, mode: "insensitive" } },
            { batchCodePrefix: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, courseGroups] = await Promise.all([
    prisma.courseGroup.count({ where }),
    prisma.courseGroup.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ category: { sortOrder: "asc" } }, { title: "asc" }],
      include,
    }),
  ]);
  return { total, courseGroups };
}

export async function create(data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initialCategory = await transaction.category.findUnique({ where: { id: data.categoryId }, select: { serviceId: true } });
      if (!initialCategory) throw new ConflictError("Category no longer exists.");
      await acquireTransactionLock(transaction, `learning-service:${initialCategory.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${data.categoryId}`);
      const category = await transaction.category.findUnique({ where: { id: data.categoryId }, include: { service: true } });
      if (!category) throw new ConflictError("Category no longer exists.");
      if (category.status === "ARCHIVED" || category.service.status === "ARCHIVED") {
        throw new ConflictError("Course groups cannot be created under an archived category.");
      }
      return transaction.courseGroup.create({ data, include });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.courseGroup.findUnique({ where: { id }, select: { categoryId: true, category: { select: { serviceId: true } } } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course-group:${id}`);
      const current = await transaction.courseGroup.findUnique({
        where: { id },
        include: { _count: { select: { courses: true } } },
      });
      if (!current) return null;
      if (current.archivedAt) throw new ConflictError("Archived course groups are read-only.");
      if (current._count.courses > 0) {
        throw new ConflictError(
          "Course group identity is immutable after its first course is created.",
          "COURSE_GROUP_IDENTITY_LOCKED",
        );
      }
      return transaction.courseGroup.update({ where: { id }, data, include });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function setArchived(id, archived) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.courseGroup.findUnique({ where: { id }, select: { categoryId: true, category: { select: { serviceId: true } } } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course-group:${id}`);
      const current = await transaction.courseGroup.findUnique({
        where: { id },
        include: { category: { select: { status: true, service: { select: { status: true } } } }, courses: { select: { status: true } } },
      });
      if (!current) return null;
      if (!archived && (current.category.status === "ARCHIVED" || current.category.service.status === "ARCHIVED")) {
        throw new ConflictError("Restore the parent category before restoring this course group.");
      }
      if (archived && current.courses.some(({ status }) => ["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(status))) {
        throw new ConflictError("Complete or cancel every active intake before archiving this course group.");
      }
      return transaction.courseGroup.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        include,
      });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function findDeletionImpact(id) {
  const group = await prisma.courseGroup.findUnique({
    where: { id },
    include: {
      _count: { select: { courses: true } },
      courses: {
        select: {
          _count: {
            select: { enrollments: true, courseSessions: true, studentProjects: true },
          },
        },
      },
    },
  });
  if (!group) return null;
  const history = group.courses.reduce(
    (sum, course) =>
      sum +
      course._count.enrollments +
      course._count.courseSessions +
      course._count.studentProjects,
    0,
  );
  return {
    resourceType: "COURSE_GROUP",
    resourceId: id,
    resourceStatus: group.archivedAt ? "ARCHIVED" : "ACTIVE",
    courses: group._count.courses,
    history,
    deletable: Boolean(group.archivedAt) && group._count.courses === 0,
  };
}

export async function remove(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.courseGroup.findUnique({ where: { id }, select: { categoryId: true, category: { select: { serviceId: true } } } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course-group:${id}`);
      const current = await transaction.courseGroup.findUnique({
        where: { id },
        include: { _count: { select: { courses: true } } },
      });
      if (!current) return null;
      if (!current.archivedAt) throw new ConflictError("Archive the course group first.");
      if (current._count.courses > 0) {
        throw new ConflictError("A course group with intake history cannot be permanently deleted.");
      }
      await transaction.courseGroup.delete({ where: { id } });
      return { id };
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
