import { publicObjectUrl } from "../config/r2.js";

// Shared by every entity that can carry either an R2-backed thumbnail
// (thumbnailObject) or a plain external thumbnailUrl (Course, StudentProject,
// and anywhere else the same mutually-exclusive pair shows up) — one
// resolution rule everywhere instead of reimplementing this per domain.
export function resolveThumbnailUrl(entity) {
  return entity.thumbnailObject?.status === "READY"
    ? publicObjectUrl(entity.thumbnailObject.objectKey)
    : entity.thumbnailUrl;
}

// The owner/admin-facing shape of an attached thumbnail object — same
// fields every domain exposes for its uploaded thumbnail, so the frontend's
// ObjectUploadField can pre-fill from any of them identically.
export function toStoredObjectSummary(object, publicUrl) {
  if (!object) return null;
  return {
    id: object.id,
    purpose: object.purpose,
    scope: object.scope,
    status: object.status,
    fileName: object.originalFileName,
    contentType: object.contentType,
    sizeBytes: Number(object.actualSizeBytes ?? object.declaredSizeBytes),
    publicUrl,
  };
}
