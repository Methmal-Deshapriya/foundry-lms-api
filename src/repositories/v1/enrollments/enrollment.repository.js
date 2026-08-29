import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import { CourseCapacityReachedError, ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";

const enrollmentInclude = {
  user: true,
  enrolledBy: true,
  course: { include: { category: { include: { service: true } }, courseGroup: true } },
  certificates: { where: { status: "ISSUED" }, orderBy: { issuedDate: "desc" }, take: 1 },
};

export function findById(id) { return prisma.enrollment.findUnique({ where: { id }, include: enrollmentInclude }); }

export async function createPaid(courseId, userId, actorId, payment) {
  try {
    const id = await prisma.$transaction(async (transaction) => {
      const initialCourse = await transaction.course.findUnique({ where: { id: courseId }, select: { category: { select: { serviceId: true } } } });
      if (!initialCourse) throw new NotFoundError("Course not found.");
      await acquireTransactionLock(transaction, `learning-service:${initialCourse.category.serviceId}`);
      await acquireTransactionLock(transaction, `course:${courseId}`);
      await acquireTransactionLock(transaction, `course-enrollment:${courseId}`);
      const course = await transaction.course.findUnique({ where: { id: courseId }, include: { category: { include: { service: true } }, courseGroup: true } });
      const student = await transaction.user.findUnique({ where: { id: userId }, select: { role: true, emailVerified: true } });
      if (!course) throw new NotFoundError("Course not found.");
      if (!student || student.role !== "STUDENT" || !student.emailVerified) throw new ConflictError("The account must be a verified student.", "INELIGIBLE_STUDENT");
      if (course.status !== "OPEN_ACTIVE" || course.courseGroup.archivedAt || course.category.status !== "PUBLISHED" || course.category.service.status !== "ACTIVE" || course.category.service.accessType !== "PAID" || course.category.service.courseMode !== "SEASONAL" || course.category.service.enrollmentMode !== "ADMIN" || course.category.service.paymentRequirement !== "REQUIRED") {
        throw new ConflictError("This course is not accepting enrollment.", "COURSE_ENROLLMENT_CLOSED");
      }
      if (await transaction.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } } })) throw new ConflictError("Student is already enrolled in this course.");
      if (course.capacity != null) {
        const occupied = await transaction.enrollment.count({ where: { courseId, status: { not: "CANCELLED" } } });
        if (occupied >= course.capacity) throw new CourseCapacityReachedError();
      }
      const enrollment = await transaction.enrollment.create({ data: { userId, courseId, source: "ADMIN", enrolledByUserId: actorId, status: "ACTIVE", ...payment }, select: { id: true } });
      return enrollment.id;
    });
    return findById(id);
  } catch (error) { if (error instanceof ConflictError || error instanceof NotFoundError) throw error; throw handlePrismaError(error); }
}

export async function enrollFree(userId, courseId) {
  try {
    const result = await prisma.$transaction(async (transaction) => {
      const initialCourse = await transaction.course.findUnique({ where: { id: courseId }, select: { category: { select: { serviceId: true } } } });
      if (!initialCourse) throw new ConflictError("This Free Learning course is not open for enrollment.");
      await acquireTransactionLock(transaction, `learning-service:${initialCourse.category.serviceId}`);
      await acquireTransactionLock(transaction, `course:${courseId}`);
      await acquireTransactionLock(transaction, `course-enrollment:${courseId}`);
      const course = await transaction.course.findFirst({
        where: {
          id: courseId,
          status: "OPEN_ACTIVE",
          courseGroup: { archivedAt: null },
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
        select: { id: true },
      });
      if (!course) throw new ConflictError("This Free Learning course is not open for enrollment.");
      const existing = await transaction.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true, status: true, source: true } });
      if (existing) {
        if (existing.source !== "SELF") throw new ConflictError("Existing enrollment has an incompatible source.");
        if (existing.status !== "CANCELLED") return { enrollmentId: existing.id, outcome: "EXISTING" };
        await transaction.enrollment.update({ where: { id: existing.id }, data: { status: "ACTIVE", completedAt: null } });
        return { enrollmentId: existing.id, outcome: "REACTIVATED" };
      }
      const enrollment = await transaction.enrollment.create({ data: { userId, courseId, source: "SELF", status: "ACTIVE", paymentStatus: "NOT_REQUIRED" }, select: { id: true } });
      return { enrollmentId: enrollment.id, outcome: "CREATED" };
    });
    return { enrollment: await findById(result.enrollmentId), outcome: result.outcome };
  } catch (error) { if (error instanceof ConflictError || error instanceof NotFoundError) throw error; throw handlePrismaError(error); }
}

export async function update(id, expected, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.enrollment.findUnique({ where: { id }, select: { courseId: true, course: { select: { category: { select: { serviceId: true } } } } } });
      if (!initial) throw new NotFoundError("Enrollment not found.");
      await acquireTransactionLock(transaction, `learning-service:${initial.course.category.serviceId}`);
      await acquireTransactionLock(transaction, `course:${initial.courseId}`);
      await acquireTransactionLock(transaction, `enrollment:${id}`);
      const current = await transaction.enrollment.findUnique({ where: { id }, include: { user: true, course: { include: { category: { include: { service: true } } } } } });
      if (!current) throw new NotFoundError("Enrollment not found.");
      if (current.status !== expected.status || current.paymentStatus !== expected.paymentStatus) throw new ConflictError("Enrollment state changed. Refresh and try again.");
      const nextStatus = data.status ?? current.status;
      const nextPayment = data.paymentStatus ?? current.paymentStatus;
      if (["COMPLETED", "ARCHIVED"].includes(current.course.status)) throw new ConflictError("Course history is frozen.");
      if (nextStatus === "COMPLETED" && !["OPEN_ACTIVE", "CLOSED_ACTIVE"].includes(current.course.status)) throw new ConflictError("Enrollment can be completed only while learning is active.");
      if (current.source === "ADMIN" && nextStatus === "COMPLETED" && nextPayment !== "COMPLETED") throw new ConflictError("Paid enrollment requires completed payment.");
      if (current.status === "CANCELLED" && nextStatus === "ACTIVE" && (current.course.status !== "OPEN_ACTIVE" || !current.user.emailVerified || current.user.role !== "STUDENT")) throw new ConflictError("Enrollment is no longer eligible for reactivation.");
      return transaction.enrollment.update({ where: { id }, data, include: enrollmentInclude });
    });
  } catch (error) { if (error instanceof ConflictError || error instanceof NotFoundError) throw error; throw handlePrismaError(error); }
}

export function findUserEnrollments(userId, { limit, cursor }) {
  return prisma.enrollment.findMany({ where: { userId }, include: enrollmentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
}

function rosterWhere(courseId, q, status, cursor) {
  return { courseId, ...(status ? { status } : {}), ...(q ? { user: { OR: [{ email: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } : {}), ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) };
}

export function findCourseEnrollments(courseId, { q = "", status, limit = 50, cursor = null }) {
  return prisma.enrollment.findMany({ where: rosterWhere(courseId, q, status, cursor), include: enrollmentInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
}

export function searchEligibleStudents(courseId, q, limit, cursor) {
  return prisma.user.findMany({
    where: { role: "STUDENT", emailVerified: true, enrollments: { none: { courseId } }, ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } : {}), ...(cursor ? { OR: [{ email: { gt: cursor.email } }, { email: cursor.email, id: { gt: cursor.id } }] } : {}) },
    orderBy: [{ email: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: { id: true, firstName: true, lastName: true, email: true },
  });
}
