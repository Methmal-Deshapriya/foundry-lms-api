import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

const courseInclude = { category: true };

export async function create(userId, courseId, extraData = {}) {
  try {
    return await prisma.enrollment.create({
      data: { userId, courseId, ...extraData },
      include: { course: { include: courseInclude } },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function findById(id) {
  return prisma.enrollment.findUnique({
    where: { id },
    include: { user: true, course: { include: courseInclude } },
  });
}

export async function update(id, data) {
  try {
    return await prisma.enrollment.update({
      where: { id },
      data,
      include: { user: true, course: { include: courseInclude } },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function findExisting(userId, courseId) {
  return prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    include: { course: { include: courseInclude } },
  });
}

export async function findUserEnrollments(userId) {
  return prisma.enrollment.findMany({
    where: { userId },
    include: { course: { include: courseInclude } },
    orderBy: { createdAt: "desc" },
  });
}

export async function findCourseEnrollments(courseId) {
  return prisma.enrollment.findMany({
    where: { courseId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
}
