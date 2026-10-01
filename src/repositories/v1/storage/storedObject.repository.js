import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

export async function create(data) {
  try {
    return await prisma.storedObject.create({ data });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function deleteById(id) {
  try {
    return await prisma.storedObject.delete({ where: { id } });
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

// Every relation that can point at a stored object. A READY object with none
// of these is unused — e.g. a replaced thumbnail, or an upload whose form was
// never saved. Keep this list in sync with the StoredObject model.
const UNREFERENCED = {
  courseThumbnails: { none: {} },
  courseExplainerVideoThumbnails: { none: {} },
  sessionRecordings: { none: {} },
  sessionMaterials: { none: {} },
  projectThumbnails: { none: {} },
  serviceHeroImages: { none: {} },
  serviceCardImages: { none: {} },
  promotionImages: { none: {} },
  studentProfileAvatar: { is: null },
  paymentProof: { is: null },
  expenseReceipt: { is: null },
};

/**
 * Files safe to delete: uploads never completed (PENDING/FAILED), and
 * completed uploads nothing references — both older than `olderThan`, so a
 * form someone is still filling in is never touched.
 */
export function findCleanupCandidates(olderThan, limit) {
  return prisma.storedObject.findMany({
    where: {
      createdAt: { lt: olderThan },
      OR: [{ status: { in: ["PENDING", "FAILED"] } }, { status: "READY", ...UNREFERENCED }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}
