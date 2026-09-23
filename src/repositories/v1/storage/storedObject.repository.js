import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

export async function create(data) {
  try {
    return await prisma.storedObject.create({ data });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export function findById(id) {
  return prisma.storedObject.findUnique({ where: { id } });
}

export async function markReady(id, { actualSizeBytes, etag }) {
  try {
    return await prisma.storedObject.update({
      where: { id },
      data: {
        status: "READY",
        actualSizeBytes,
        etag,
        readyAt: new Date(),
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function markFailed(id) {
  try {
    return await prisma.storedObject.update({
      where: { id },
      data: { status: "FAILED" },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
