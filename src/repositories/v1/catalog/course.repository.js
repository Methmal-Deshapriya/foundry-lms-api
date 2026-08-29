import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

export const courseInclude = {
  category: { include: { service: true } },
  courseGroup: true,
  _count: {
    select: {
      courseSessions: { where: { retiredAt: null } },
      enrollments: true,
      studentProjects: true,
    },
  },
};

export function findById(id) {
  return prisma.course.findUnique({ where: { id }, include: courseInclude });
}

export function findPublicDetail(serviceId, categorySlug, courseSlug) {
  return prisma.course.findFirst({
    where: {
      slug: courseSlug,
      status: "OPEN_ACTIVE",
      courseGroup: { archivedAt: null },
      category: { serviceId, slug: categorySlug, status: "PUBLISHED", service: { status: "ACTIVE" } },
    },
    include: {
      courseGroup: true,
      category: {
        include: {
          service: true,
          courses: { where: { status: "OPEN_ACTIVE", courseGroup: { archivedAt: null } }, select: { level: true } },
          _count: { select: { courses: { where: { status: "OPEN_ACTIVE", courseGroup: { archivedAt: null } } } } },
        },
      },
    },
  });
}

export function findPublishedFreeById(id) {
  return prisma.course.findFirst({
    where: {
      id,
      status: "OPEN_ACTIVE",
      courseGroup: { archivedAt: null },
      category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "FREE", courseMode: "EVERGREEN", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" } },
    },
    include: courseInclude,
  });
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.courseGroupId ? { courseGroupId: filters.courseGroupId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.serviceId ? { category: { serviceId: filters.serviceId } } : {}),
    ...(filters.q ? { OR: [
      { title: { contains: filters.q, mode: "insensitive" } },
      { slug: { contains: filters.q, mode: "insensitive" } },
      { code: { contains: filters.q, mode: "insensitive" } },
      { intakeKey: { contains: filters.q, mode: "insensitive" } },
    ] } : {}),
  };
  const [total, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ category: { sortOrder: "asc" } }, { courseGroup: { title: "asc" } }, { startDate: "desc" }, { createdAt: "desc" }],
      include: courseInclude,
    }),
  ]);
  return { total, courses };
}

export async function create(data, sourceCourseId = null) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initialGroup = await transaction.courseGroup.findUnique({ where: { id: data.courseGroupId }, select: { category: { select: { serviceId: true } } } });
      if (!initialGroup) throw new NotFoundError("Course group not found.");
      await acquireTransactionLock(transaction, `learning-service:${initialGroup.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${data.categoryId}`);
      await acquireTransactionLock(transaction, `course-group:${data.courseGroupId}`);
      const group = await transaction.courseGroup.findUnique({
        where: { id: data.courseGroupId },
        include: { category: { include: { service: true } }, courses: { select: { id: true } } },
      });
      if (!group) throw new NotFoundError("Course group not found.");
      if (group.archivedAt || group.category.status === "ARCHIVED" || group.category.service.status === "ARCHIVED") throw new ConflictError("Archived catalog setup cannot create courses.");
      if (data.categoryId !== group.categoryId) throw new ConflictError("Course and course group must belong to the same category.");
      if (!sourceCourseId && group.courses.length > 0) {
        throw new ConflictError(
          "Create later course intakes by copying an existing course in this group.",
          "COURSE_SOURCE_REQUIRED",
        );
      }
      if (group.category.service.courseMode === "EVERGREEN" && group.courses.length > 0) {
        throw new ConflictError("A Free Learning course group can have only one evergreen course.");
      }
      if (sourceCourseId) {
        const sourceCourse = await transaction.course.findFirst({
          where: { id: sourceCourseId, courseGroupId: data.courseGroupId },
          select: { id: true },
        });
        if (!sourceCourse) throw new ConflictError("Source course must belong to this course group.");
        await acquireTransactionLock(transaction, `course:${sourceCourseId}`);
      }
      const course = await transaction.course.create({ data, include: courseInclude });
      if (sourceCourseId) {
        const source = await transaction.courseSession.findMany({
          where: {
            courseId: sourceCourseId,
            retiredAt: null,
            session: { status: "READY" },
          },
          orderBy: { orderIndex: "asc" },
          select: { sessionId: true, orderIndex: true },
        });
        if (source.length > 0) {
          await transaction.courseSession.createMany({
            data: source.map((item) => ({
              courseId: course.id,
              sessionId: item.sessionId,
              orderIndex: item.orderIndex,
              deliveryStatus: "UNRELEASED",
            })),
          });
        }
      }
      return course;
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function updateSetup(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({
        where: { id },
        select: { categoryId: true, courseGroupId: true, category: { select: { serviceId: true } } },
      });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course-group:${initial.courseGroupId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const current = await transaction.course.findUnique({ where: { id } });
      if (!current) return null;
      if (["COMPLETED", "CANCELLED", "ARCHIVED"].includes(current.status)) throw new ConflictError("Terminal courses are read-only.");
      if (data.capacity !== undefined && data.capacity !== null) {
        const learnerCount = await transaction.enrollment.count({
          where: { courseId: id, status: { not: "CANCELLED" } },
        });
        if (data.capacity < learnerCount) {
          throw new ConflictError(
            `Capacity cannot be lower than the ${learnerCount} current learner(s).`,
            "COURSE_CAPACITY_BELOW_ENROLLMENT_COUNT",
          );
        }
      }
      return transaction.course.update({ where: { id }, data, include: courseInclude });
    });
  } catch (error) { throw handlePrismaError(error); }
}

async function assertCompletionReady(transaction, course) {
  const sessions = await transaction.courseSession.findMany({
    where: { courseId: course.id, retiredAt: null },
    select: { deliveryStatus: true, availableAt: true },
  });
  const now = new Date();
  if (
    sessions.length === 0 ||
    sessions.some(
      ({ deliveryStatus, availableAt }) =>
        deliveryStatus !== "RELEASED" &&
        !(deliveryStatus === "SCHEDULED" && availableAt && availableAt <= now),
    )
  ) {
    throw new ConflictError("Release every current session before completing this course.", "COURSE_COMPLETION_NOT_READY");
  }
  const enrollments = await transaction.enrollment.findMany({
    where: { courseId: course.id, status: { not: "CANCELLED" } },
    select: { status: true, certificates: { where: { status: "ISSUED" }, select: { id: true }, take: 1 } },
  });
  if (enrollments.some(({ status }) => status !== "COMPLETED")) throw new ConflictError("Complete every non-cancelled enrollment first.", "COURSE_COMPLETION_NOT_READY");
  if (course.courseGroup.certificateEnabled && enrollments.some(({ certificates }) => certificates.length === 0)) {
    throw new ConflictError("Issue certificates to every completed learner first.", "COURSE_COMPLETION_NOT_READY");
  }
}

export async function transitionStatus(id, expectedStatus, targetStatus) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({
        where: { id },
        select: { categoryId: true, courseGroupId: true, category: { select: { serviceId: true } } },
      });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course-group:${initial.courseGroupId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const course = await transaction.course.findUnique({ where: { id }, include: { category: { include: { service: true } }, courseGroup: true } });
      if (!course) return null;
      if (course.status !== expectedStatus) throw new ConflictError("Course status changed. Refresh and try again.", "STALE_COURSE_STATUS");
      if (targetStatus === "OPEN_ACTIVE") {
        if (course.category.service.status !== "ACTIVE" || course.category.status !== "PUBLISHED" || course.courseGroup.archivedAt) throw new ConflictError("Only a course under an active service/group and published category can be opened.");
        if (course.category.service.courseMode === "EVERGREEN") {
          const visible = await transaction.courseSession.count({
            where: {
              courseId: id,
              retiredAt: null,
              OR: [
                { deliveryStatus: "RELEASED" },
                { deliveryStatus: "SCHEDULED", availableAt: { lte: new Date() } },
              ],
            },
          });
          if (visible === 0) throw new ConflictError("Release at least one session before opening free enrollment.");
        }
        await transaction.course.updateMany({
          where: { courseGroupId: course.courseGroupId, status: "OPEN_ACTIVE", id: { not: id } },
          data: { status: "CLOSED_ACTIVE" },
        });
      }
      if (targetStatus === "COMPLETED") await assertCompletionReady(transaction, course);
      if (targetStatus === "CANCELLED") {
        await transaction.enrollment.updateMany({ where: { courseId: id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      }
      return transaction.course.update({ where: { id }, data: { status: targetStatus }, include: courseInclude });
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function removePermanently(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({
        where: { id },
        select: { categoryId: true, courseGroupId: true, category: { select: { serviceId: true } } },
      });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course-group:${initial.courseGroupId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const course = await transaction.course.findUnique({
        where: { id },
        include: { _count: { select: { enrollments: true, courseSessions: true, studentProjects: true } } },
      });
      if (!course) return null;
      if (course.status !== "ARCHIVED") throw new ConflictError("Archive the course first.");
      if (course._count.enrollments || course._count.courseSessions || course._count.studentProjects) {
        throw new ConflictError("A course with curriculum or learner history cannot be permanently deleted.", "CATALOG_DELETION_BLOCKED");
      }
      await transaction.course.delete({ where: { id } });
      return { id };
    });
  } catch (error) { throw handlePrismaError(error); }
}
