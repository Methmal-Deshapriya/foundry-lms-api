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
      course: { include: { category: true } },
      batch: true,
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

export async function findAllAdmin({ q = "", status, limit = 50, cursor = null }) {
  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { certificateCode: { contains: q, mode: "insensitive" } },
            { studentName: { contains: q, mode: "insensitive" } },
            { courseName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
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
  return await prisma.certificate.findMany({
    where,
    include: certificateInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
}

export async function findUserCertificates(userId) {
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
    orderBy: { issuedDate: "desc" },
  });
}

export async function createIssued(data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initialEnrollment = await transaction.enrollment.findUnique({
        where: { id: data.enrollmentId },
        select: { courseId: true, batchId: true },
      });
      if (!initialEnrollment) throw new NotFoundError("Enrollment not found.");
      await acquireTransactionLock(
        transaction,
        `curriculum:${initialEnrollment.courseId}`,
      );
      if (initialEnrollment.batchId) {
        await acquireTransactionLock(
          transaction,
          `batch:${initialEnrollment.batchId}`,
        );
      }
      await acquireTransactionLock(transaction, `enrollment:${data.enrollmentId}`);
      const enrollment = await transaction.enrollment.findUnique({
        where: { id: data.enrollmentId },
        select: {
          status: true,
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
        select: { courseId: true, batchId: true },
      });
      if (!initialEnrollment) throw new NotFoundError("Enrollment not found.");
      // Use the global curriculum -> batch -> enrollment order so revocation
      // cannot race a batch completion readiness decision.
      await acquireTransactionLock(
        transaction,
        `curriculum:${initialEnrollment.courseId}`,
      );
      if (initialEnrollment.batchId) {
        await acquireTransactionLock(
          transaction,
          `batch:${initialEnrollment.batchId}`,
        );
      }
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
        batchId: current.enrollment.batchId,
        batchStatus: current.enrollment.batch?.status ?? null,
        courseStatus: current.enrollment.course.status,
        categoryStatus: current.enrollment.course.category.status,
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
