import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = {
  course: true,
  intake: true,
  student: true,
  contactedBy: true,
};

export function findById(id) {
  return prisma.enrollmentRequest.findUnique({ where: { id }, include });
}

function where(intakeId, filters) {
  return {
    intakeId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          student: {
            OR: [
              { email: { contains: filters.q, mode: "insensitive" } },
              { firstName: { contains: filters.q, mode: "insensitive" } },
              { lastName: { contains: filters.q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };
}

// Offset-paginated, same shared/full-where split as the enrollment roster:
// the status-breakdown summary always applies the search text but not the
// status filter, so switching status pills doesn't change the other pills.
export async function findForIntake(intakeId, filters) {
  const sharedWhere = where(intakeId, { q: filters.q });
  const fullWhere = { ...sharedWhere, ...(filters.status ? { status: filters.status } : {}) };
  const [total, statusCounts, requests] = await Promise.all([
    prisma.enrollmentRequest.count({ where: fullWhere }),
    prisma.enrollmentRequest.groupBy({ by: ["status"], where: sharedWhere, _count: true }),
    prisma.enrollmentRequest.findMany({
      where: fullWhere,
      include,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filters.limit,
      skip: filters.offset,
    }),
  ]);
  return { total, statusCounts, requests };
}

/**
 * Creates a request against the course's currently OPEN_ACTIVE intake,
 * resolved server-side — the student never picks or knows about an intake.
 * A student can only have one open (PENDING/CONTACTED) request per course at
 * a time.
 */
export async function create(courseId, studentUserId, contactPhone) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const course = await transaction.course.findUnique({
        where: { id: courseId },
        include: { intakes: { where: { status: "OPEN_ACTIVE" }, take: 1 } },
      });
      if (!course) throw new NotFoundError("Course not found.");
      const intake = course.intakes[0];
      if (!intake) throw new ConflictError("This course is not currently enrolling.", "COURSE_NOT_ENROLLING");
      const existing = await transaction.enrollmentRequest.findFirst({
        where: { courseId, studentUserId, status: { in: ["PENDING", "CONTACTED"] } },
      });
      if (existing) throw new ConflictError("You already have an open enrollment request for this course.", "ENROLLMENT_REQUEST_ALREADY_OPEN");
      return transaction.enrollmentRequest.create({
        data: { courseId, intakeId: intake.id, studentUserId, contactPhone, status: "PENDING" },
        include,
      });
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function updateStatus(id, expectedStatus, targetStatus, contactedByUserId = null) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `enrollment-request:${id}`);
      const current = await transaction.enrollmentRequest.findUnique({ where: { id } });
      if (!current) return null;
      if (current.status !== expectedStatus) throw new ConflictError("Enrollment request status changed. Refresh and try again.", "STALE_ENROLLMENT_REQUEST_STATUS");
      return transaction.enrollmentRequest.update({
        where: { id },
        data: {
          status: targetStatus,
          ...(targetStatus === "CONTACTED" ? { contactedAt: new Date(), contactedByUserId } : {}),
        },
        include,
      });
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}

/** Links a converted request to the Enrollment it produced — permanent audit trail. */
export async function markEnrolled(transaction, id, enrollmentId) {
  return transaction.enrollmentRequest.update({
    where: { id },
    data: { status: "ENROLLED", enrollmentId },
    include,
  });
}
