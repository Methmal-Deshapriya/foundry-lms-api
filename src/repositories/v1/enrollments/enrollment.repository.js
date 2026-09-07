import { Prisma } from "@prisma/client";
import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import { CourseCapacityReachedError, ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";

// The initial Payment row an enrollment gets at creation time. A FULL
// payment earns its course's fixed one-time-payment discount; a PARTIAL
// payment is exactly half the undiscounted price and never discounted, even
// once its later top-up (see completePayment) completes it — the discount
// only exists as a reward for paying in one go.
function buildInitialPaymentEntry(course, paymentStatus) {
  const price = new Prisma.Decimal(course.price);
  if (paymentStatus === "COMPLETED") {
    const discountAmount = new Prisma.Decimal(course.discountAmount);
    const amount = price.minus(discountAmount);
    if (amount.lessThanOrEqualTo(0)) throw new ConflictError("Course price must exceed the full-payment discount.", "PRICE_BELOW_DISCOUNT");
    return { type: "FULL", amount, discountAmount, currency: course.currency };
  }
  if (paymentStatus === "PARTIAL") {
    return { type: "PARTIAL", amount: price.dividedBy(2), discountAmount: new Prisma.Decimal(0), currency: course.currency };
  }
  return null;
}

const enrollmentInclude = {
  user: true,
  enrolledBy: true,
  course: { include: { category: { include: { service: true } } } },
  intake: true,
  // Not filtered to ISSUED: the roster/detail views need to tell "revoked"
  // apart from "never issued" (a REVOKED certificate doesn't block issuing a
  // new one — see certificate.repository.js's findCurrentByEnrollmentId,
  // which does filter to ISSUED for that eligibility check).
  certificates: { orderBy: { issuedDate: "desc" }, take: 1 },
};

export function findById(id) { return prisma.enrollment.findUnique({ where: { id }, include: enrollmentInclude }); }

export async function createPaid(intakeId, userId, actorId, payment) {
  try {
    const id = await prisma.$transaction(async (transaction) => {
      const initialIntake = await transaction.intake.findUnique({ where: { id: intakeId }, select: { category: { select: { serviceId: true } } } });
      if (!initialIntake) throw new NotFoundError("Intake not found.");
      await acquireTransactionLock(transaction, `learning-service:${initialIntake.category.serviceId}`);
      await acquireTransactionLock(transaction, `intake:${intakeId}`);
      await acquireTransactionLock(transaction, `intake-enrollment:${intakeId}`);
      const intake = await transaction.intake.findUnique({ where: { id: intakeId }, include: { category: { include: { service: true } }, course: true } });
      const student = await transaction.user.findUnique({ where: { id: userId }, select: { role: true, emailVerified: true } });
      if (!intake) throw new NotFoundError("Intake not found.");
      if (!student || student.role !== "STUDENT" || !student.emailVerified) throw new ConflictError("The account must be a verified student.", "INELIGIBLE_STUDENT");
      if (intake.status !== "OPEN_ACTIVE" || intake.course.archivedAt || intake.category.status !== "PUBLISHED" || intake.category.service.status !== "ACTIVE" || intake.category.service.accessType !== "PAID" || intake.category.service.courseMode !== "SEASONAL" || intake.category.service.enrollmentMode !== "ADMIN" || intake.category.service.paymentRequirement !== "REQUIRED") {
        throw new ConflictError("This intake is not accepting enrollment.", "COURSE_ENROLLMENT_CLOSED");
      }
      if (await transaction.enrollment.findUnique({ where: { userId_intakeId: { userId, intakeId } } })) throw new ConflictError("Student is already enrolled in this intake.");
      if (intake.capacity != null) {
        const occupied = await transaction.enrollment.count({ where: { intakeId, status: { not: "CANCELLED" } } });
        if (occupied >= intake.capacity) throw new CourseCapacityReachedError();
      }
      const enrollment = await transaction.enrollment.create({ data: { userId, courseId: intake.courseId, intakeId, source: "ADMIN", enrolledByUserId: actorId, status: "ACTIVE", ...payment }, select: { id: true } });
      const entry = buildInitialPaymentEntry(intake.course, payment.paymentStatus);
      if (entry) await transaction.payment.create({ data: { enrollmentId: enrollment.id, courseId: intake.courseId, intakeId, recordedByUserId: actorId, ...entry } });
      return enrollment.id;
    });
    return findById(id);
  } catch (error) { if (error instanceof ConflictError || error instanceof NotFoundError) throw error; throw handlePrismaError(error); }
}

// Records the remaining half of a PARTIAL enrollment's price — the only
// state a PARTIAL enrollment can move to. Never discounted: the discount
// is only ever earned by paying everything in one go at enrollment time.
export async function completePayment(id, actorId) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.enrollment.findUnique({ where: { id }, select: { intakeId: true, intake: { select: { category: { select: { serviceId: true } } } } } });
      if (!initial) throw new NotFoundError("Enrollment not found.");
      await acquireTransactionLock(transaction, `learning-service:${initial.intake.category.serviceId}`);
      await acquireTransactionLock(transaction, `intake:${initial.intakeId}`);
      await acquireTransactionLock(transaction, `enrollment:${id}`);
      const current = await transaction.enrollment.findUnique({ where: { id }, include: { course: true } });
      if (!current) throw new NotFoundError("Enrollment not found.");
      if (current.paymentStatus !== "PARTIAL") throw new ConflictError("Only a partially paid enrollment can have its remaining payment recorded.", "PAYMENT_NOT_PARTIAL");
      const amount = new Prisma.Decimal(current.course.price).dividedBy(2);
      await transaction.payment.create({ data: { enrollmentId: id, courseId: current.courseId, intakeId: current.intakeId, recordedByUserId: actorId, type: "TOP_UP", amount, discountAmount: new Prisma.Decimal(0), currency: current.course.currency } });
      await transaction.enrollment.update({ where: { id }, data: { paymentStatus: "COMPLETED", paymentCompletedAt: new Date() } });
      return transaction.enrollment.findUnique({ where: { id }, include: enrollmentInclude });
    });
  } catch (error) { if (error instanceof ConflictError || error instanceof NotFoundError) throw error; throw handlePrismaError(error); }
}

export async function enrollFree(userId, intakeId) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const initialIntake = await transaction.intake.findUnique({ where: { id: intakeId }, select: { category: { select: { serviceId: true } } } });
      if (!initialIntake) throw new ConflictError("This Free Learning course is not open for enrollment.");
      await acquireTransactionLock(transaction, `learning-service:${initialIntake.category.serviceId}`);
      await acquireTransactionLock(transaction, `intake:${intakeId}`);
      await acquireTransactionLock(transaction, `intake-enrollment:${intakeId}`);
      const intake = await transaction.intake.findFirst({
        where: {
          id: intakeId,
          status: "OPEN_ACTIVE",
          course: { archivedAt: null },
          category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "FREE", courseMode: "EVERGREEN", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" } },
          courseSessions: {
            some: {
              retiredAt: null,
              OR: [
                { deliveryStatus: "RELEASED" },
                { deliveryStatus: "SCHEDULED", availableAt: { lte: new Date() } },
              ],
            },
          },
        },
        select: { id: true, courseId: true },
      });
      if (!intake) throw new ConflictError("This Free Learning course is not open for enrollment.");
      const existing = await transaction.enrollment.findUnique({ where: { userId_intakeId: { userId, intakeId } }, select: { id: true, status: true, source: true } });
      if (existing) {
        if (existing.source !== "SELF") throw new ConflictError("Existing enrollment has an incompatible source.");
        if (existing.status !== "CANCELLED") return { enrollmentId: existing.id, outcome: "EXISTING" };
        await transaction.enrollment.update({ where: { id: existing.id }, data: { status: "ACTIVE", completedAt: null } });
        return { enrollmentId: existing.id, outcome: "REACTIVATED" };
      }
      const enrollment = await transaction.enrollment.create({ data: { userId, courseId: intake.courseId, intakeId, source: "SELF", status: "ACTIVE", paymentStatus: "NOT_REQUIRED" }, select: { id: true } });
      return { enrollmentId: enrollment.id, outcome: "CREATED" };
    });
    return { enrollment: await findById(result.enrollmentId), outcome: result.outcome };
  } catch (error) { if (error instanceof ConflictError || error instanceof NotFoundError) throw error; throw handlePrismaError(error); }
}

export async function update(id, expected, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.enrollment.findUnique({ where: { id }, select: { intakeId: true, intake: { select: { category: { select: { serviceId: true } } } } } });
      if (!initial) throw new NotFoundError("Enrollment not found.");
      await acquireTransactionLock(transaction, `learning-service:${initial.intake.category.serviceId}`);
      await acquireTransactionLock(transaction, `intake:${initial.intakeId}`);
      await acquireTransactionLock(transaction, `enrollment:${id}`);
      const current = await transaction.enrollment.findUnique({ where: { id }, include: { user: true, intake: { include: { category: { include: { service: true } } } } } });
      if (!current) throw new NotFoundError("Enrollment not found.");
      if (current.status !== expected.status || current.paymentStatus !== expected.paymentStatus) throw new ConflictError("Enrollment state changed. Refresh and try again.");
      const nextStatus = data.status ?? current.status;
      const nextPayment = data.paymentStatus ?? current.paymentStatus;
      if (["COMPLETED", "ARCHIVED"].includes(current.intake.status)) throw new ConflictError("Intake history is frozen.");
      if (nextStatus === "COMPLETED" && !["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(current.intake.status)) throw new ConflictError("Enrollment can be completed only while learning is active.");
      if (current.source === "ADMIN" && nextStatus === "COMPLETED" && nextPayment !== "COMPLETED") throw new ConflictError("Paid enrollment requires completed payment.");
      if (current.status === "CANCELLED" && nextStatus === "ACTIVE" && (current.intake.status !== "OPEN_ACTIVE" || !current.user.emailVerified || current.user.role !== "STUDENT")) throw new ConflictError("Enrollment is no longer eligible for reactivation.");
      return transaction.enrollment.update({ where: { id }, data, include: enrollmentInclude });
    });
  } catch (error) { if (error instanceof ConflictError || error instanceof NotFoundError) throw error; throw handlePrismaError(error); }
}

export function findUserEnrollments(userId, { limit, cursor }) {
  return prisma.enrollment.findMany({ where: { userId }, include: enrollmentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
}

// Batched session-progress lookup for a page of enrollments, mirroring
// classroom.service.js's progressFromRows without the N+1 of calling the
// per-enrollment classroom endpoint once per card on the My Courses list.
// "Visible" mirrors classroom.repository.js's findVisibleSessions exactly
// (released, or scheduled-and-due, with a ready/archived session) so the
// count here always matches what a student would see in the classroom.
export async function findProgressForEnrollments(enrollments) {
  const progress = new Map();
  if (enrollments.length === 0) return progress;

  const now = new Date();
  const intakeIds = [...new Set(enrollments.map(({ intakeId }) => intakeId))];
  const visibleSessions = await prisma.courseSession.findMany({
    where: {
      intakeId: { in: intakeIds },
      deliveryStatus: { in: ["RELEASED", "SCHEDULED"] },
      OR: [
        { deliveryStatus: "RELEASED" },
        { deliveryStatus: "SCHEDULED", availableAt: { lte: now } },
      ],
      session: { status: { in: ["READY", "ARCHIVED"] } },
    },
    select: { id: true, intakeId: true },
  });

  const visibleCountByIntake = new Map();
  const visibleSessionIds = [];
  for (const session of visibleSessions) {
    visibleSessionIds.push(session.id);
    visibleCountByIntake.set(session.intakeId, (visibleCountByIntake.get(session.intakeId) ?? 0) + 1);
  }

  const completions = visibleSessionIds.length > 0
    ? await prisma.sessionCompletion.findMany({
        where: {
          enrollmentId: { in: enrollments.map(({ id }) => id) },
          courseSessionId: { in: visibleSessionIds },
        },
        select: { enrollmentId: true },
      })
    : [];
  const completedCountByEnrollment = new Map();
  for (const { enrollmentId } of completions) {
    completedCountByEnrollment.set(enrollmentId, (completedCountByEnrollment.get(enrollmentId) ?? 0) + 1);
  }

  for (const enrollment of enrollments) {
    const availableSessionCount = visibleCountByIntake.get(enrollment.intakeId) ?? 0;
    const completedCount = completedCountByEnrollment.get(enrollment.id) ?? 0;
    progress.set(enrollment.id, {
      completedCount,
      availableSessionCount,
      progressPercent: availableSessionCount > 0 ? Math.round((completedCount / availableSessionCount) * 100) : 0,
    });
  }
  return progress;
}

function rosterWhere(intakeId, q) {
  return { intakeId, ...(q ? { user: { OR: [{ email: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } : {}) };
}

// Offset-paginated, scoped to one intake — session release, capacity, and
// the roster itself are all intake-wise concerns (see the rename plan §6).
// `total` and the status-breakdown `summary` both apply the search text but
// not the status filter, so switching status pills doesn't change the other
// pills' counts — same shared/full-where split Session Library's status
// pills use.
export async function findCourseEnrollments(intakeId, { q = "", status, limit = 50, offset = 0 }) {
  const sharedWhere = rosterWhere(intakeId, q);
  const where = { ...sharedWhere, ...(status ? { status } : {}) };
  const [total, statusCounts, enrollments] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.groupBy({ by: ["status"], where: sharedWhere, _count: true }),
    prisma.enrollment.findMany({ where, include: enrollmentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
  ]);
  return { enrollments, total, statusCounts };
}

export function searchEligibleStudents(intakeId, q, limit, cursor) {
  // The search and cursor conditions each need their own OR group. Spreading
  // both into one object under the same "OR" key would let the second
  // silently overwrite the first, dropping the search filter on any page
  // past the first — so each becomes its own entry under AND instead.
  const conditions = [];
  if (q) {
    conditions.push({
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (cursor) {
    conditions.push({
      OR: [
        { email: { gt: cursor.email } },
        { email: cursor.email, id: { gt: cursor.id } },
      ],
    });
  }
  return prisma.user.findMany({
    where: {
      role: "STUDENT",
      emailVerified: true,
      enrollments: { none: { intakeId } },
      ...(conditions.length ? { AND: conditions } : {}),
    },
    orderBy: [{ email: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: { id: true, firstName: true, lastName: true, email: true },
  });
}
