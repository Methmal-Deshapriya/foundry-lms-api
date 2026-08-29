import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const publicCourseWhere = { status: "OPEN_ACTIVE", courseGroup: { archivedAt: null } };

export function findPublicByService(serviceId) {
  return prisma.category.findMany({
    where: { serviceId, status: "PUBLISHED", service: { status: "ACTIVE" } },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: {
      courses: { where: publicCourseWhere, select: { level: true } },
      _count: { select: { courses: { where: publicCourseWhere } } },
      service: true,
    },
  });
}

export function findPublicBySlug(serviceId, slug) {
  return prisma.category.findFirst({
    where: { serviceId, slug, status: "PUBLISHED", service: { status: "ACTIVE" } },
    include: {
      courses: { where: publicCourseWhere, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], include: { courseGroup: true } },
      _count: { select: { courses: { where: publicCourseWhere } } },
      service: true,
    },
  });
}

export function findById(id) {
  return prisma.category.findUnique({ where: { id }, include: { service: true, _count: { select: { courses: true, courseGroups: true } } } });
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q ? { OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { slug: { contains: filters.q, mode: "insensitive" } }] } : {}),
  };
  const [total, categories] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({ where, orderBy: [{ service: { sortOrder: "asc" } }, { sortOrder: "asc" }, { title: "asc" }], take: limit, skip: offset, include: { service: true, _count: { select: { courses: true, courseGroups: true } } } }),
  ]);
  return { total, categories };
}

export async function create(data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `learning-service:${data.serviceId}`);
      const service = await transaction.learningService.findUnique({ where: { id: data.serviceId } });
      if (!service) throw new NotFoundError("Learning service not found.");
      if (service.status === "ARCHIVED") throw new ConflictError("Learning service is archived.");
      return transaction.category.create({ data, include: { service: true } });
    });
  } catch (error) { throw handlePrismaError(error); }
}

async function updateLocked(id, operation) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.category.findUnique({ where: { id }, select: { serviceId: true } });
      if (!initial) throw new NotFoundError("Category not found.");
      await acquireTransactionLock(transaction, `learning-service:${initial.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${id}`);
      const current = await transaction.category.findUnique({ where: { id }, include: { service: true } });
      if (!current) throw new NotFoundError("Category not found.");
      return operation(transaction, current);
    });
  } catch (error) { throw handlePrismaError(error); }
}

export function update(id, data) { return updateLocked(id, (transaction) => transaction.category.update({ where: { id }, data, include: { service: true, _count: { select: { courses: true, courseGroups: true } } } })); }

export function updateOperational(id, data) {
  return updateLocked(id, (transaction, current) => {
    if (Object.hasOwn(data, "serviceId")) throw new ConflictError("A category's learning service cannot be changed.");
    if (current.status === "ARCHIVED") throw new ConflictError("Archived categories cannot be edited.");
    return transaction.category.update({ where: { id }, data, include: { service: true, _count: { select: { courses: true, courseGroups: true } } } });
  });
}

export function setPublication(id, publish) {
  return updateLocked(id, (transaction, current) => {
    if (current.status === "ARCHIVED") throw new ConflictError("Archived categories cannot be published.");
    if (publish && current.service.status !== "ACTIVE") throw new ConflictError("Activate the parent learning service before publishing this category.");
    return transaction.category.update({ where: { id }, data: { status: publish ? "PUBLISHED" : "DRAFT" }, include: { service: true, _count: { select: { courses: true, courseGroups: true } } } });
  });
}

export function restore(id) {
  return updateLocked(id, (transaction, current) => {
    if (current.status !== "ARCHIVED") throw new ConflictError("Only archived categories can be restored.");
    if (current.service.status === "ARCHIVED") throw new ConflictError("Restore the parent learning service first.");
    return transaction.category.update({ where: { id }, data: { status: "DRAFT" }, include: { service: true, _count: { select: { courses: true, courseGroups: true } } } });
  });
}

export function archiveSafely(id) {
  return updateLocked(id, async (transaction) => {
    const groups = await transaction.courseGroup.findMany({
      where: { categoryId: id },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    for (const group of groups) {
      await acquireTransactionLock(transaction, `course-group:${group.id}`);
    }
    const activeCount = await transaction.course.count({
      where: { categoryId: id, status: { in: ["OPEN_ACTIVE", "CLOSED_ACTIVE"] } },
    });
    if (activeCount > 0) {
      throw new ConflictError(
        "Complete or cancel every active course intake before archiving this category.",
        "CATALOG_ARCHIVE_BLOCKED",
      );
    }
    const archivedGroups = await transaction.courseGroup.updateMany({ where: { categoryId: id, archivedAt: null }, data: { archivedAt: new Date() } });
    const category = await transaction.category.update({ where: { id }, data: { status: "ARCHIVED" }, include: { service: true, _count: { select: { courses: true, courseGroups: true } } } });
    return { category, archivedCourseGroupCount: archivedGroups.count };
  });
}

export async function findDeletionImpact(id) {
  const category = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { courses: true, courseGroups: true } }, courses: { select: { _count: { select: { enrollments: true, courseSessions: true, studentProjects: true } } } } },
  });
  if (!category) return null;
  const history = category.courses.reduce((sum, course) => sum + course._count.enrollments + course._count.courseSessions + course._count.studentProjects, 0);
  return { resourceType: "CATEGORY", resourceId: id, resourceStatus: category.status, courses: category._count.courses, courseGroups: category._count.courseGroups, history, deletable: category.status === "ARCHIVED" && history === 0 };
}

export function removePermanently(id) {
  return updateLocked(id, async (transaction, current) => {
    if (current.status !== "ARCHIVED") throw new ConflictError("Only archived categories can be permanently deleted.");
    const history = await transaction.enrollment.count({ where: { course: { categoryId: id } } });
    const curriculum = await transaction.courseSession.count({ where: { course: { categoryId: id } } });
    const projects = await transaction.studentProject.count({ where: { course: { categoryId: id } } });
    if (history || curriculum || projects) throw new ConflictError("Category learner or curriculum history blocks permanent deletion.", "CATALOG_DELETION_BLOCKED");
    const deletedCourses = await transaction.course.deleteMany({ where: { categoryId: id } });
    const deletedCourseGroups = await transaction.courseGroup.deleteMany({ where: { categoryId: id } });
    await transaction.category.delete({ where: { id } });
    return {
      id,
      deletedCourses: deletedCourses.count,
      deletedCourseGroups: deletedCourseGroups.count,
    };
  });
}
