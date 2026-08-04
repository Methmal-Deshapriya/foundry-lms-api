import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Certificate Repository
 */

export async function findById(id) {
  return await prisma.certificate.findUnique({
    where: { id },
    include: {
      enrollment: {
        include: {
          user: true,
          course: { include: { category: true } },
        },
      },
    },
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
    include: {
      enrollment: {
        include: {
          user: true,
          course: { include: { category: true } },
        },
      },
    },
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
