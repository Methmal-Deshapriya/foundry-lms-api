import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import { recomputeCourseEnrollmentStatus } from "./course.repository.js";

export const intakeInclude = {
  category: { include: { service: true } },
  course: true,
  _count: {
    select: {
      courseSessions: { where: { retiredAt: null } },
      enrollments: true,
      studentProjects: true,
      enrollmentRequests: true,
    },
  },
};

export function findById(id) {
  return prisma.intake.findUnique({ where: { id }, include: intakeInclude });
}

/**
 * Public, self-enroll resolution for a FREE/evergreen course's one perpetual
 * intake. Per the 2026-08-30 rename plan §8, self-enroll always takes a
 * concrete Intake id — the public page resolves "the course's current open
 * intake" first (via course.repository's public lookups) and hands that id
 * here.
 */
export function findPublishedFreeIntakeById(intakeId) {
  return prisma.intake.findFirst({
    where: {
      id: intakeId,
      status: "OPEN_ACTIVE",
      course: { archivedAt: null },
      category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "FREE", courseMode: "EVERGREEN", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" } },
    },
    include: intakeInclude,
  });
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.courseId ? { courseId: filters.courseId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.serviceId ? { category: { serviceId: filters.serviceId } } : {}),
    ...(filters.q ? { OR: [
      { code: { contains: filters.q, mode: "insensitive" } },
      { intakeKey: { contains: filters.q, mode: "insensitive" } },
      { course: { title: { contains: filters.q, mode: "insensitive" } } },
    ] } : {}),
  };
  const [total, intakes] = await Promise.all([
    prisma.intake.count({ where }),
    prisma.intake.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ category: { sortOrder: "asc" } }, { course: { title: "asc" } }, { startDate: "desc" }, { createdAt: "desc" }],
      include: intakeInclude,
    }),
  ]);
  return { total, intakes };
}

/**
 * Suggests defaults for the create-intake form per the rename plan §3a: a
 * date-coded next intakeKey ("2026-1", "2026-2", rolling to "2027-1"), and
 * the most recent sibling intake's timezone (falling back to Asia/Colombo for
 * the first intake under a course). Both remain editable overrides.
 */
export async function suggestIntakeDefaults(courseId) {
  const siblings = await prisma.intake.findMany({
    where: { courseId },
    select: { intakeKey: true, timezone: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const year = new Date().getFullYear();
  const yearPrefix = `${year}-`;
  const nextOrdinal =
    1 +
    siblings.reduce((max, { intakeKey }) => {
      if (!intakeKey.startsWith(yearPrefix)) return max;
      const ordinal = Number(intakeKey.slice(yearPrefix.length));
      return Number.isInteger(ordinal) && ordinal > max ? ordinal : max;
    }, 0);
  return {
    intakeKey: `${year}-${nextOrdinal}`,
    timezone: siblings[0]?.timezone ?? "Asia/Colombo",
  };
}

export async function create(courseId, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initialCourse = await transaction.course.findUnique({ where: { id: courseId }, select: { category: { select: { serviceId: true } } } });
      if (!initialCourse) throw new NotFoundError("Course not found.");
      await acquireTransactionLock(transaction, `learning-service:${initialCourse.category.serviceId}`);
      await acquireTransactionLock(transaction, `course:${courseId}`);
      const course = await transaction.course.findUnique({
        where: { id: courseId },
        include: { category: { include: { service: true } }, intakes: { select: { id: true } } },
      });
      if (!course) throw new NotFoundError("Course not found.");
      if (course.archivedAt || course.category.status === "ARCHIVED" || course.category.service.status === "ARCHIVED") {
        throw new ConflictError("Archived catalog setup cannot create intakes.");
      }
      if (course.category.service.courseMode === "EVERGREEN" && course.intakes.length > 0) {
        throw new ConflictError("A Free Learning course can have only one evergreen intake.");
      }
      const intake = await transaction.intake.create({
        data: {
          courseId: course.id,
          categoryId: course.categoryId,
          intakeKey: data.intakeKey,
          code: `${course.intakeCodePrefix}-${data.intakeKey}`,
          startDate: data.startDate ?? null,
          expectedEndDate: data.expectedEndDate ?? null,
          timezone: data.timezone,
          capacity: data.capacity ?? null,
          status: "DRAFT",
        },
        include: intakeInclude,
      });
      await recomputeCourseEnrollmentStatus(transaction, course.id);
      return intake;
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function updateSetup(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.intake.findUnique({
        where: { id },
        select: { categoryId: true, courseId: true, category: { select: { serviceId: true } } },
      });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `course:${initial.courseId}`);
      await acquireTransactionLock(transaction, `intake:${id}`);
      const current = await transaction.intake.findUnique({ where: { id } });
      if (!current) return null;
      if (["COMPLETED", "CANCELLED", "ARCHIVED"].includes(current.status)) throw new ConflictError("Terminal intakes are read-only.");
      if (data.capacity !== undefined && data.capacity !== null) {
        const learnerCount = await transaction.enrollment.count({
          where: { intakeId: id, status: { not: "CANCELLED" } },
        });
        if (data.capacity < learnerCount) {
          throw new ConflictError(
            `Capacity cannot be lower than the ${learnerCount} current learner(s).`,
            "INTAKE_CAPACITY_BELOW_ENROLLMENT_COUNT",
          );
        }
      }
      return transaction.intake.update({ where: { id }, data, include: intakeInclude });
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

async function assertCompletionReady(transaction, intake) {
  const sessions = await transaction.courseSession.findMany({
    where: { intakeId: intake.id, retiredAt: null },
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
    throw new ConflictError("Release every current session before completing this intake.", "INTAKE_COMPLETION_NOT_READY");
  }
  const enrollments = await transaction.enrollment.findMany({
    where: { intakeId: intake.id, status: { not: "CANCELLED" } },
    select: { status: true, certificates: { where: { status: "ISSUED" }, select: { id: true }, take: 1 } },
  });
  if (enrollments.some(({ status }) => status !== "COMPLETED")) throw new ConflictError("Complete every non-cancelled enrollment first.", "INTAKE_COMPLETION_NOT_READY");
  if (intake.course.certificateEnabled && enrollments.some(({ certificates }) => certificates.length === 0)) {
    throw new ConflictError("Issue certificates to every completed learner first.", "INTAKE_COMPLETION_NOT_READY");
  }
}

export async function transitionStatus(id, expectedStatus, targetStatus) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.intake.findUnique({
        where: { id },
        select: { categoryId: true, courseId: true, category: { select: { serviceId: true } } },
      });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `course:${initial.courseId}`);
      await acquireTransactionLock(transaction, `intake:${id}`);
      const intake = await transaction.intake.findUnique({ where: { id }, include: { category: { include: { service: true } }, course: true } });
      if (!intake) return null;
      if (intake.status !== expectedStatus) throw new ConflictError("Intake status changed. Refresh and try again.", "STALE_INTAKE_STATUS");
      if (targetStatus === "OPEN_ACTIVE") {
        if (intake.category.service.status !== "ACTIVE" || intake.category.status !== "PUBLISHED" || intake.course.archivedAt) throw new ConflictError("Only an intake under an active service/course and published category can be opened.");
        if (intake.category.service.courseMode === "EVERGREEN") {
          const visible = await transaction.courseSession.count({
            where: {
              intakeId: id,
              retiredAt: null,
              OR: [
                { deliveryStatus: "RELEASED" },
                { deliveryStatus: "SCHEDULED", availableAt: { lte: new Date() } },
              ],
            },
          });
          if (visible === 0) throw new ConflictError("Release at least one session before opening free enrollment.");
        }
        // Only one Intake per Course can stay OPEN_ACTIVE — see the rename
        // plan §2b, this rule already existed pre-rename, just renamed.
        await transaction.intake.updateMany({
          where: { courseId: intake.courseId, status: "OPEN_ACTIVE", id: { not: id } },
          data: { status: "CLOSED_ACTIVE" },
        });
      }
      if (targetStatus === "COMPLETED") await assertCompletionReady(transaction, intake);
      if (targetStatus === "CANCELLED") {
        await transaction.enrollment.updateMany({ where: { intakeId: id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      }
      const updated = await transaction.intake.update({ where: { id }, data: { status: targetStatus }, include: intakeInclude });
      await recomputeCourseEnrollmentStatus(transaction, intake.courseId);
      return updated;
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function getAnalytics(intakeId) {
  const intake = await prisma.intake.findUnique({
    where: { id: intakeId },
    select: { capacity: true, course: { select: { currency: true, certificateEnabled: true } } },
  });
  if (!intake) return null;

  const [
    statusGroups,
    revenueAgg,
    paymentTypeGroups,
    districtRows,
    sessionRows,
    projectGroups,
    certificatesIssuedCount,
    eligibleEnrollmentCount,
  ] = await Promise.all([
    prisma.enrollment.groupBy({ by: ["status"], where: { intakeId }, _count: true }),
    prisma.payment.aggregate({ where: { intakeId }, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["type"], where: { intakeId }, _sum: { amount: true }, _count: true }),
    // Prisma's query builder has no way to group by a related model's
    // column, so the district breakdown is a small raw query — same
    // pattern as the tag-substring search in sessionLibrary.repository.js.
    prisma.$queryRaw`
      SELECT u.district AS district, COUNT(*)::int AS count
      FROM enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.intake_id = ${intakeId} AND e.status != 'CANCELLED' AND u.district IS NOT NULL
      GROUP BY u.district ORDER BY count DESC
    `,
    prisma.courseSession.findMany({
      where: { intakeId, retiredAt: null },
      select: {
        id: true,
        orderIndex: true,
        session: { select: { title: true } },
        _count: { select: { completions: true } },
      },
      orderBy: { orderIndex: "asc" },
    }),
    prisma.studentProject.groupBy({ by: ["status"], where: { intakeId }, _count: true }),
    prisma.certificate.count({ where: { enrollment: { intakeId }, status: "ISSUED" } }),
    prisma.enrollment.count({ where: { intakeId, status: { in: ["ACTIVE", "COMPLETED"] } } }),
  ]);

  return {
    intake,
    statusGroups,
    revenueAgg,
    paymentTypeGroups,
    districtRows,
    sessionRows,
    projectGroups,
    certificatesIssuedCount,
    eligibleEnrollmentCount,
  };
}

export async function removePermanently(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.intake.findUnique({
        where: { id },
        select: { categoryId: true, courseId: true, category: { select: { serviceId: true } } },
      });
      if (!initial) return null;
      await acquireTransactionLock(transaction, `learning-service:${initial.category.serviceId}`);
      await acquireTransactionLock(transaction, `course:${initial.courseId}`);
      await acquireTransactionLock(transaction, `intake:${id}`);
      const intake = await transaction.intake.findUnique({
        where: { id },
        include: { _count: { select: { enrollments: true, courseSessions: true, studentProjects: true, enrollmentRequests: true } } },
      });
      if (!intake) return null;
      if (intake.status !== "ARCHIVED") throw new ConflictError("Archive the intake first.");
      if (intake._count.enrollments || intake._count.courseSessions || intake._count.studentProjects) {
        throw new ConflictError("An intake with curriculum or learner history cannot be permanently deleted.", "CATALOG_DELETION_BLOCKED");
      }
      // EnrollmentRequest.intake is a Restrict FK — even a DECLINED/terminal
      // request would otherwise fail the delete below with a raw, unfriendly
      // constraint error instead of this clean one. See Finding C of the
      // 2026-08-30 system guide/audit.
      if (intake._count.enrollmentRequests) {
        throw new ConflictError("An intake with enrollment request history cannot be permanently deleted.", "CATALOG_DELETION_BLOCKED");
      }
      await transaction.intake.delete({ where: { id } });
      await recomputeCourseEnrollmentStatus(transaction, intake.courseId);
      return { id };
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
