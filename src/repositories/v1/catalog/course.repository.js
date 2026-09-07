import prisma from "../../../utils/prisma.js";
import { ConflictError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = {
  category: { include: { service: true } },
  intakes: {
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    include: {
      category: true,
      course: true,
      _count: { select: { courseSessions: true, enrollments: true, studentProjects: true } },
    },
  },
  _count: { select: { intakes: true } },
};

export function findById(id) {
  return prisma.course.findUnique({ where: { id }, include });
}

/**
 * Public detail-page lookup. Per the 2026-08-30 rename plan §8, a Course is
 * always served once created — this no longer filters out courses with no
 * open intake, it just won't have one to hand the "Enroll" button. The
 * currently OPEN_ACTIVE intake (if any) is included for the caller to resolve
 * the enroll target and show seats/dates.
 */
export function findPublicDetail(serviceId, categorySlug, courseSlug) {
  return prisma.course.findFirst({
    where: {
      slug: courseSlug,
      archivedAt: null,
      category: { serviceId, slug: categorySlug, status: "PUBLISHED", service: { status: "ACTIVE" } },
    },
    include: {
      intakes: {
        where: { status: "OPEN_ACTIVE" },
        take: 1,
        include: { _count: { select: { enrollments: { where: { status: { not: "CANCELLED" } } } } } },
      },
      category: {
        include: {
          service: true,
          courses: { where: { enrollmentStatus: { not: "COMING_SOON" }, archivedAt: null }, select: { level: true } },
          _count: { select: { courses: { where: { enrollmentStatus: { not: "COMING_SOON" }, archivedAt: null } } } },
        },
      },
    },
  });
}

/**
 * Public "Explore" listing — every published course across every active
 * service, flattened into one filterable/searchable list. Unlike the
 * per-category browse path, callers only ever know slugs (never ids), so
 * every filter here is slug-based.
 */
export async function findPublicExplore(filters, limit, offset) {
  const where = {
    archivedAt: null,
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.minPrice != null || filters.maxPrice != null
      ? {
          price: {
            ...(filters.minPrice != null ? { gte: filters.minPrice } : {}),
            ...(filters.maxPrice != null ? { lte: filters.maxPrice } : {}),
          },
        }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { summary: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
    category: {
      status: "PUBLISHED",
      ...(filters.category ? { slug: filters.category } : {}),
      service: {
        status: "ACTIVE",
        ...(filters.service ? { slug: filters.service } : {}),
        ...(filters.accessType ? { accessType: filters.accessType } : {}),
      },
    },
  };

  const [total, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      include: { category: { include: { service: true } } },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { title: "asc" }],
      take: limit,
      skip: offset,
    }),
  ]);

  return { total, courses };
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.serviceId ? { category: { serviceId: filters.serviceId } } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.enrollmentStatus ? { enrollmentStatus: filters.enrollmentStatus } : {}),
    ...(!filters.includeArchived ? { archivedAt: null } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { slug: { contains: filters.q, mode: "insensitive" } },
            { intakeCodePrefix: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ category: { sortOrder: "asc" } }, { title: "asc" }],
      include,
    }),
  ]);
  return { total, courses };
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
        throw new ConflictError("Courses cannot be created under an archived category.");
      }
      return transaction.course.create({ data, include });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({ where: { id }, select: { categoryId: true, category: { select: { serviceId: true } } } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const current = await transaction.course.findUnique({ where: { id } });
      if (!current) return null;
      if (current.archivedAt) throw new ConflictError("Archived courses are read-only.");
      return transaction.course.update({ where: { id }, data, include });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function setArchived(id, archived) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({ where: { id }, select: { categoryId: true, category: { select: { serviceId: true } } } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: { category: { select: { status: true, service: { select: { status: true } } } }, intakes: { select: { status: true } } },
      });
      if (!current) return null;
      if (!archived && (current.category.status === "ARCHIVED" || current.category.service.status === "ARCHIVED")) {
        throw new ConflictError("Restore the parent category before restoring this course.");
      }
      if (archived && current.intakes.some(({ status }) => ["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(status))) {
        throw new ConflictError("Complete or cancel every active intake before archiving this course.");
      }
      return transaction.course.update({
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
  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      _count: { select: { intakes: true } },
      intakes: {
        select: {
          _count: {
            select: { enrollments: true, courseSessions: true, studentProjects: true },
          },
        },
      },
    },
  });
  if (!course) return null;
  const history = course.intakes.reduce(
    (sum, intake) =>
      sum +
      intake._count.enrollments +
      intake._count.courseSessions +
      intake._count.studentProjects,
    0,
  );
  return {
    resourceType: "COURSE",
    resourceId: id,
    resourceStatus: course.archivedAt ? "ARCHIVED" : "ACTIVE",
    intakes: course._count.intakes,
    history,
    deletable: Boolean(course.archivedAt) && course._count.intakes === 0,
  };
}

export async function remove(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({ where: { id }, select: { categoryId: true, category: { select: { serviceId: true } } } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `catalog-category:${initial.categoryId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: { _count: { select: { intakes: true } } },
      });
      if (!current) return null;
      if (!current.archivedAt) throw new ConflictError("Archive the course first.");
      if (current._count.intakes > 0) {
        throw new ConflictError("A course with intake history cannot be permanently deleted.");
      }
      await transaction.course.delete({ where: { id } });
      return { id };
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Recomputes and writes a Course's derived `enrollmentStatus` from its
 * current intakes. Called from within the same transaction at every place an
 * intake's existence or status can change — intake create, transitionStatus,
 * and intake delete — per the 2026-08-30 rename plan §8. Never set directly
 * by a client.
 */
export async function recomputeCourseEnrollmentStatus(transaction, courseId) {
  const [anyIntake, openIntake] = await Promise.all([
    transaction.intake.findFirst({ where: { courseId }, select: { id: true } }),
    transaction.intake.findFirst({ where: { courseId, status: "OPEN_ACTIVE" }, select: { id: true } }),
  ]);
  const enrollmentStatus = openIntake ? "OPEN" : anyIntake ? "REOPENING_SOON" : "COMING_SOON";
  await transaction.course.update({ where: { id: courseId }, data: { enrollmentStatus } });
  return enrollmentStatus;
}

/**
 * Resolves a course's currently OPEN_ACTIVE intake id, or null if none is
 * open right now. Used both when a visitor files an enrollment request and
 * when an admin later converts a stale one whose original intake has since
 * closed — see Finding I of the 2026-08-30 system guide/audit.
 */
export async function findCurrentOpenIntakeId(courseId) {
  const intake = await prisma.intake.findFirst({ where: { courseId, status: "OPEN_ACTIVE" }, select: { id: true } });
  return intake?.id ?? null;
}

/**
 * Course-level (cross-intake) rollup — total revenue, enrollment outcomes,
 * and certificates for every intake this program has ever run. Mirrors
 * intake.repository.js's getAnalytics() but filters on courseId instead of
 * intakeId; the dual-key design on Enrollment/Payment (see the 2026-08-30
 * system guide/audit §1.6) exists specifically so this needs no join.
 * Districts and per-session engagement are intake-workspace-only — they
 * don't aggregate meaningfully across intakes that may each run different
 * curricula — see the 2026-08-31 course detail page improvement plan §4.
 */
export async function getAnalytics(courseId) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { currency: true, certificateEnabled: true },
  });
  if (!course) return null;

  const [statusGroups, revenueAgg, paymentTypeGroups, projectGroups, certificatesIssuedCount] = await Promise.all([
    prisma.enrollment.groupBy({ by: ["status"], where: { courseId }, _count: true }),
    prisma.payment.aggregate({ where: { courseId }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["type"], where: { courseId }, _sum: { amount: true }, _count: true }),
    prisma.studentProject.groupBy({ by: ["status"], where: { intake: { courseId } }, _count: true }),
    prisma.certificate.count({ where: { enrollment: { courseId }, status: "ISSUED" } }),
  ]);

  return { course, statusGroups, revenueAgg, paymentTypeGroups, projectGroups, certificatesIssuedCount };
}
