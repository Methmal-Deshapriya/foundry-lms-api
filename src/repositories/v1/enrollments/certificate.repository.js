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

export async function findByEnrollmentId(enrollmentId) {
  return await prisma.certificate.findUnique({
    where: { enrollmentId },
  });
}

export async function findAllAdmin() {
  return await prisma.certificate.findMany({
    include: certificateInclude,
    orderBy: { createdAt: "desc" },
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

export async function create(data) {
  try {
    return await prisma.certificate.create({
      data,
    });
  } catch (error) {
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

      // Serialize with enrollment completion/status operations so lifecycle
      // context and revocation are captured from one authoritative state.
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
