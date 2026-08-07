import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Student Project Repository
 */

export async function findById(id) {
  return await prisma.studentProject.findUnique({
    where: { id },
    include: {
      user: true,
      course: true,
      enrollment: true,
    },
  });
}

export async function findByUserId(userId) {
  return await prisma.studentProject.findMany({
    where: { userId },
    include: {
      course: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findAllAdmin() {
  return await prisma.studentProject.findMany({
    include: {
      user: true,
      course: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findPublicShowcase() {
  return await prisma.studentProject.findMany({
    where: {
      status: "APPROVED",
      isPublic: true,
    },
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      course: {
        select: {
          title: true,
        },
      },
    },
    orderBy: [
      { likeCount: "desc" },
      { createdAt: "desc" },
    ],
  });
}

export async function create(data) {
  try {
    return await prisma.studentProject.create({
      data,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.studentProject.update({
      where: { id },
      data,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function remove(id) {
  try {
    return await prisma.studentProject.delete({
      where: { id },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
