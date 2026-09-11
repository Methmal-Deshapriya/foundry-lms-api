import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import {
  ConflictError,
  NotFoundError,
  handlePrismaError,
} from "../../../utils/Errors.js";

const certificateInclude = {
  enrollment: {
    include: {
      user: true,
      course: true,
      intake: { include: { category: true } },
    },
  },
};

/**
 * Certificate Repository
 */

export async function findById(id) {
  return await prisma.certificate.findUnique({
    where: { id },
    include: certificateInclude,
  });
}

export async function findByCode(certificateCode) {
  return await prisma.certificate.findUnique({
    where: { certificateCode },
  });
}

export async function findCurrentByEnrollmentId(enrollmentId) {
  return await prisma.certificate.findFirst({
    where: { enrollmentId, status: "ISSUED" },
    orderBy: { issuedDate: "desc" },
  });
}

function certificateSharedWhere({ q = "", intakeId }) {
  return {
    ...(intakeId ? { enrollment: { intakeId } } : {}),
    ...(q
      ? {
          OR: [
            { certificateCode: { contains: q, mode: "insensitive" } },
            { studentName: { contains: q, mode: "insensitive" } },
            { courseName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

// Two pagination modes share this function: cursor (the global /admin
// certificates page — unbounded, keyset) and offset (the intake
// workspace's Certificates tab — one intake, bounded, wants a real
// "page N of M" + total, same as Session Library). Offset mode is
// selected by passing `offset` (a number, including 0); omit it entirely
// for cursor mode. `summary` is cheap enough to compute either way.
export async function findAllAdmin({ q = "", status, intakeId, limit = 50, cursor = null, offset = null }) {
  const sharedWhere = certificateSharedWhere({ q, intakeId });
  const where = { ...sharedWhere, ...(status ? { status } : {}) };

  const statusCounts = await prisma.certificate.groupBy({ by: ["status"], where: sharedWhere, _count: true });

  if (offset != null) {
    const [total, certificates] = await Promise.all([
      prisma.certificate.count({ where }),
      prisma.certificate.findMany({
        where,
        include: certificateInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        skip: offset,
      }),
    ]);
    return { mode: "offset", certificates, total, statusCounts };
  }

  const cursorWhere = {
    ...where,
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  };
  const certificates = await prisma.certificate.findMany({
    where: cursorWhere,
    include: certificateInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  return { mode: "cursor", certificates, statusCounts };
}

export async function findUserCertificates(userId, { limit, cursor }) {
  return await prisma.certificate.findMany({
    where: {
      enrollment: {
        userId,
      },
    },
    include: {
      enrollment: {
        include: {
          course: { include: { category: true } },
        },
      },
    },
    orderBy: [{ issuedDate: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
}

export async function createIssued(data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initialEnrollment = await transaction.enrollment.findUnique({
        where: { id: data.enrollmentId },
        select: { intakeId: true },
      });
      if (!initialEnrollment) throw new NotFoundError("Enrollment not found.");
      await acquireTransactionLock(
        transaction,
        `intake:${initialEnrollment.intakeId}`,
      );
      await acquireTransactionLock(transaction, `enrollment:${data.enrollmentId}`);
      const enrollment = await transaction.enrollment.findUnique({
        where: { id: data.enrollmentId },
        select: {
          status: true,
          paymentStatus: true,
          course: { select: { certificateEnabled: true } },
        },
      });
      if (!enrollment) throw new NotFoundError("Enrollment not found.");
      if (enrollment.status !== "COMPLETED") {
        throw new ConflictError(
          "Enrollment must remain completed while issuing a certificate.",
          "CERTIFICATE_ISSUANCE_BLOCKED",
        );
      }
      // NOT_REQUIRED covers free enrollments, which never transition to
      // COMPLETED since there's no payment to complete — without this they
      // could never receive a certificate at all.
      if (enrollment.paymentStatus !== "COMPLETED" && enrollment.paymentStatus !== "NOT_REQUIRED") {
        throw new ConflictError(
          "This student hasn't completed payment yet — record the remaining payment before issuing a certificate.",
          "CERTIFICATE_ISSUANCE_BLOCKED",
        );
      }
      if (!enrollment.course.certificateEnabled) {
        throw new ConflictError(
          "Certificates are not enabled for this course.",
          "CERTIFICATE_ISSUANCE_BLOCKED",
        );
      }
      const current = await transaction.certificate.findFirst({
        where: { enrollmentId: data.enrollmentId, status: "ISSUED" },
        select: { id: true },
      });
      if (current) {
        throw new ConflictError(
          "A current certificate has already been issued for this enrollment.",
          "CERTIFICATE_ALREADY_ISSUED",
        );
      }
      return transaction.certificate.create({ data });
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.certificate.update({
      where: { id },
      data,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function revokeIssued(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.certificate.findUnique({
        where: { id },
        select: { enrollmentId: true },
      });
      if (!initial) throw new NotFoundError("Certificate not found.");

      const initialEnrollment = await transaction.enrollment.findUnique({
        where: { id: initial.enrollmentId },
        select: { intakeId: true },
      });
      if (!initialEnrollment) throw new NotFoundError("Enrollment not found.");
      // Use the global intake -> enrollment order so revocation cannot race a
      // completion readiness decision.
      await acquireTransactionLock(
        transaction,
        `intake:${initialEnrollment.intakeId}`,
      );
      await acquireTransactionLock(
        transaction,
        `enrollment:${initial.enrollmentId}`,
      );
      const current = await transaction.certificate.findUnique({
        where: { id },
        include: certificateInclude,
      });
      if (!current) throw new NotFoundError("Certificate not found.");
      if (current.status === "REVOKED") {
        throw new ConflictError("Certificate is already revoked.");
      }

      const lifecycleContext = {
        enrollmentStatus: current.enrollment.status,
        intakeStatus: current.enrollment.intake.status,
        categoryStatus: current.enrollment.intake.category.status,
      };
      const certificate = await transaction.certificate.update({
        where: { id },
        data,
        include: certificateInclude,
      });
      return { certificate, lifecycleContext };
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}
