import prisma from "../../../utils/prisma.js";
import { ConflictError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = {
  service: true,
  thumbnailObject: true,
  intakes: {
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    include: {
      service: true,
      course: true,
      _count: { select: { courseSessions: true, enrollments: true, studentProjects: true } },
    },
  },
  _count: { select: { intakes: true } },
};

// A Course is always served once created — see the 2026-08-30 rename plan
// §8. Enrollment availability is communicated via `enrollmentStatus`, not by
// hiding the course from the public catalog.
const publicCourseWhere = { archivedAt: null };

export function findById(id) {
  return prisma.course.findUnique({ where: { id }, include });
}

/**
 * Public Level-2 listing — every published course directly under a service.
 * Replaces the old Category-grouped browse path (see the 2026-09-22
 * category layer removal plan).
 */
export function findPublicByService(serviceId) {
  return prisma.course.findMany({
    where: { serviceId, status: "PUBLISHED", ...publicCourseWhere, service: { status: "ACTIVE" } },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: { service: true, thumbnailObject: true },
  });
}

/**
 * Public detail-page lookup. Per the 2026-08-30 rename plan §8, a Course is
 * always served once created — this no longer filters out courses with no
 * open intake, it just won't have one to hand the "Enroll" button. The
 * currently OPEN_ACTIVE intake (if any) is included for the caller to resolve
 * the enroll target and show seats/dates.
 */
export function findPublicDetail(serviceId, courseSlug) {
  return prisma.course.findFirst({
    where: {
      slug: courseSlug,
      serviceId,
      status: "PUBLISHED",
      ...publicCourseWhere,
      service: { status: "ACTIVE" },
    },
    include: {
      intakes: {
        where: { status: "OPEN_ACTIVE" },
        take: 1,
        include: { _count: { select: { enrollments: { where: { status: { not: "CANCELLED" } } } } } },
      },
      service: true,
      thumbnailObject: true,
    },
  });
}

/**
 * Public "Explore" listing — every published course across every active
 * service, flattened into one filterable/searchable list. Unlike the
 * per-service browse path, callers only ever know slugs (never ids), so
 * every filter here is slug-based.
 */
export async function findPublicExplore(filters, limit, offset) {
  const where = {
    archivedAt: null,
    status: "PUBLISHED",
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
    service: {
      status: "ACTIVE",
      ...(filters.service ? { slug: filters.service } : {}),
      ...(filters.accessType ? { accessType: filters.accessType } : {}),
    },
  };

  const [total, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      include: { service: true, thumbnailObject: true },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      take: limit,
      skip: offset,
    }),
  ]);

  return { total, courses };
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
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
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      include,
    }),
  ]);
  return { total, courses };
}

export async function create(data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `learning-service:${data.serviceId}`);
      const service = await transaction.learningService.findUnique({ where: { id: data.serviceId } });
      if (!service) throw new ConflictError("Learning service no longer exists.");
      if (service.status === "ARCHIVED") {
        throw new ConflictError("Courses cannot be created under an archived learning service.");
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
      const initial = await transaction.course.findUnique({ where: { id }, select: { serviceId: true } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.serviceId}`);
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

/**
 * Ported from category.repository.js's setPublication — Course now owns its
 * own Draft/Published/Archived lifecycle directly, taking over exactly what
 * Category's status used to gate for public visibility (see the 2026-09-22
 * category layer removal plan §3).
 */
export async function setPublication(id, publish) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({ where: { id }, select: { serviceId: true } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.serviceId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const current = await transaction.course.findUnique({ where: { id }, include: { service: true } });
      if (!current) return null;
      if (current.status === "ARCHIVED") throw new ConflictError("Archived courses cannot be published.");
      if (publish && current.service.status !== "ACTIVE") {
        throw new ConflictError("Activate the parent learning service before publishing this course.");
      }
      return transaction.course.update({
        where: { id },
        data: { status: publish ? "PUBLISHED" : "DRAFT" },
        include,
      });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function setArchived(id, archived) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({ where: { id }, select: { serviceId: true } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.serviceId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: { service: { select: { status: true } }, intakes: { select: { status: true } } },
      });
      if (!current) return null;
      if (!archived && current.service.status === "ARCHIVED") {
        throw new ConflictError("Activate the parent learning service before restoring this course.");
      }
      if (archived && current.intakes.some(({ status }) => ["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(status))) {
        throw new ConflictError(
          "Complete or cancel every active intake before archiving this course.",
          "CATALOG_ARCHIVE_BLOCKED",
        );
      }
      return transaction.course.update({
        where: { id },
        data: {
          archivedAt: archived ? new Date() : null,
          // Archiving now also moves status to ARCHIVED (mirrors what
          // archiving a Category used to do to its courses); restoring drops
          // back to DRAFT — an admin must explicitly re-publish, same as
          // Category's restore() used to require.
          status: archived ? "ARCHIVED" : "DRAFT",
        },
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
    resourceStatus: course.status,
    intakes: course._count.intakes,
    history,
    deletable: course.status === "ARCHIVED" && course._count.intakes === 0,
  };
}

export async function remove(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.course.findUnique({ where: { id }, select: { serviceId: true } });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.serviceId}`);
      await acquireTransactionLock(transaction, `course:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: { _count: { select: { intakes: true } } },
      });
      if (!current) return null;
      if (current.status !== "ARCHIVED") throw new ConflictError("Archive the course first.");
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
