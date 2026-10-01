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
      // The reference check applies to every status, not just READY: cheap
      // insurance should anything ever attach a non-READY object.
      status: { in: ["PENDING", "FAILED", "READY"] },
      ...UNREFERENCED,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/**
 * Deletes the row only if nothing references it at this moment, in one
 * statement, so a form that attaches the object at the same time either
 * keeps it (the delete matches nothing) or is refused by its own FK check.
 * Callers delete the R2 bytes only when this returns true, so a live record
 * can never end up pointing at a deleted file (code review M04-04/M04-07).
 */
export async function deleteIfUnreferenced(id) {
  try {
    const { count } = await prisma.storedObject.deleteMany({ where: { id, ...UNREFERENCED } });
    return count === 1;
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/** Uploads a user started but hasn't completed recently (for the per-user cap). */
export function countRecentPending(userId, since) {
  return prisma.storedObject.count({ where: { uploadedByUserId: userId, status: "PENDING", createdAt: { gte: since } } });
}

// Exported so a test can check it covers every StoredObject relation.
export const UNREFERENCED_RELATIONS = Object.keys(UNREFERENCED);
