import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  createDownloadUrl,
  createUploadUrl,
  getR2Config,
  inspectObject,
  isR2Enabled,
  publicObjectUrl,
} from "../../../config/r2.js";
import {
  createUploadIntentSchema,
  storedObjectIdSchema,
} from "../../../constants/v1/storage/storage.schema.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import * as repository from "../../../repositories/v1/storage/storedObject.repository.js";
import { recordActionService } from "../audit/audit.service.js";
import { PERMISSIONS, hasPermission } from "../../../constants/v1/auth/permissions.constants.js";

const PURPOSE_POLICIES = Object.freeze({
  COURSE_THUMBNAIL: {
    scope: "PUBLIC",
    prefix: "course-thumbnails",
    contentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    maxBytesEnv: "R2_MAX_IMAGE_BYTES",
    defaultMaxBytes: 10_485_760,
  },
  SESSION_RECORDING: {
    scope: "PRIVATE",
    prefix: "session-recordings",
    contentTypes: ["video/mp4", "video/webm", "video/quicktime"],
    maxBytesEnv: "R2_MAX_RECORDING_BYTES",
    defaultMaxBytes: 5_368_709_120,
  },
  SESSION_MATERIAL: {
    scope: "PRIVATE",
    prefix: "session-materials",
    contentTypes: [
      "application/pdf",
      "application/zip",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ],
    maxBytesEnv: "R2_MAX_MATERIAL_BYTES",
    defaultMaxBytes: 104_857_600,
  },
  PROJECT_THUMBNAIL: {
    scope: "PUBLIC",
    prefix: "project-thumbnails",
    contentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    maxBytesEnv: "R2_MAX_PROJECT_THUMBNAIL_BYTES",
    defaultMaxBytes: 5_242_880,
  },
});

// Every other purpose is admin-only (gated by STORAGE_MANAGE at the route
// level). Project thumbnails are the one purpose a student uploads directly,
// so this is the one exception carved out below rather than opening the
// whole endpoint up by role.
const SELF_SERVICE_PURPOSES = new Set(["PROJECT_THUMBNAIL"]);

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return result.data;
}

function requireR2() {
  if (!isR2Enabled()) {
    throw new ConflictError(
      "Object storage is not configured. Set the server R2 environment variables first.",
      "STORAGE_NOT_CONFIGURED",
    );
  }
  return getR2Config();
}

function maxBytes(policy) {
  const value = Number(process.env[policy.maxBytesEnv] ?? policy.defaultMaxBytes);
  return Number.isInteger(value) && value > 0 ? value : policy.defaultMaxBytes;
}

function safeExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function toResponse(object) {
  return {
    id: object.id,
    purpose: object.purpose,
    scope: object.scope,
    status: object.status,
    fileName: object.originalFileName,
    contentType: object.contentType,
    sizeBytes: Number(object.actualSizeBytes ?? object.declaredSizeBytes),
    publicUrl:
      object.status === "READY" && object.scope === "PUBLIC"
        ? publicObjectUrl(object.objectKey)
        : null,
    readyAt: object.readyAt,
    createdAt: object.createdAt,
  };
}

export async function createUploadIntentService(data, actorId, actorRole) {
  const config = requireR2();
  const input = parse(createUploadIntentSchema, data);
  if (!hasPermission(actorRole, PERMISSIONS.STORAGE_MANAGE) && !SELF_SERVICE_PURPOSES.has(input.purpose)) {
    throw new ForbiddenError("You do not have permission to upload this type of file.");
  }
  const policy = PURPOSE_POLICIES[input.purpose];
  if (!policy.contentTypes.includes(input.contentType.toLowerCase())) {
    throw new ValidationError(
      `Unsupported file type for ${input.purpose.toLowerCase().replaceAll("_", " ")}.`,
      "contentType",
    );
  }
  if (input.sizeBytes > maxBytes(policy)) {
    throw new ValidationError(
      `File exceeds the ${Math.floor(maxBytes(policy) / 1_048_576)} MB limit.`,
      "sizeBytes",
    );
  }

  const id = randomUUID();
  const now = new Date();
  const objectKey = `${policy.prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}${safeExtension(input.fileName)}`;
  const object = await repository.create({
    id,
    objectKey,
    scope: policy.scope,
    purpose: input.purpose,
    originalFileName: input.fileName,
    contentType: input.contentType.toLowerCase(),
    declaredSizeBytes: BigInt(input.sizeBytes),
    uploadedByUserId: actorId,
  });

  let uploadUrl;
  try {
    uploadUrl = await createUploadUrl({
      scope: object.scope,
      objectKey: object.objectKey,
      contentType: object.contentType,
    });
  } catch (error) {
    await repository.markFailed(object.id);
    throw error;
  }

  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.STORED_OBJECT_UPLOAD_CREATED,
    entityType: ENTITY_TYPES.STORED_OBJECT,
    entityId: object.id,
    description: `Upload created for ${object.originalFileName}.`,
    metadata: { purpose: object.purpose, scope: object.scope, sizeBytes: input.sizeBytes },
  });

  return {
    object: toResponse(object),
    upload: {
      method: "PUT",
      url: uploadUrl,
      headers: { "Content-Type": object.contentType },
      expiresAt: new Date(Date.now() + config.uploadTtlSeconds * 1000),
    },
  };
}

export async function completeUploadService(idValue, actorId, actorRole) {
  requireR2();
  const id = parse(storedObjectIdSchema, idValue);
  const object = await repository.findById(id);
  if (!object) throw new NotFoundError("Stored object not found.");
  if (!hasPermission(actorRole, PERMISSIONS.STORAGE_MANAGE) && object.uploadedByUserId !== actorId) {
    throw new ForbiddenError("You can only complete your own uploads.");
  }
  if (object.status === "READY") return toResponse(object);
  if (object.status !== "PENDING") {
    throw new ConflictError("This upload can no longer be completed.");
  }

  let head;
  try {
    head = await inspectObject({ scope: object.scope, objectKey: object.objectKey });
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      throw new ConflictError("The file has not reached object storage yet.", "UPLOAD_NOT_FOUND");
    }
    throw error;
  }
  const actualSize = Number(head.ContentLength ?? -1);
  const declaredSize = Number(object.declaredSizeBytes);
  if (actualSize !== declaredSize) {
    throw new ConflictError(
      "Uploaded file size does not match the declared size. Upload the file again.",
      "UPLOAD_SIZE_MISMATCH",
    );
  }
  const actualType = String(head.ContentType ?? "").toLowerCase();
  if (actualType !== object.contentType) {
    throw new ConflictError(
      "Uploaded file type does not match the declared type. Upload the file again.",
      "UPLOAD_TYPE_MISMATCH",
    );
  }
  const ready = await repository.markReady(id, {
    actualSizeBytes: BigInt(actualSize),
    etag: head.ETag?.replaceAll('"', "") ?? null,
  });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.STORED_OBJECT_UPLOAD_COMPLETED,
    entityType: ENTITY_TYPES.STORED_OBJECT,
    entityId: id,
    description: `Upload completed for ${ready.originalFileName}.`,
    metadata: { purpose: ready.purpose, scope: ready.scope, sizeBytes: actualSize },
  });
  return toResponse(ready);
}

export async function getStoredObjectAccessService(idValue) {
  requireR2();
  const id = parse(storedObjectIdSchema, idValue);
  const object = await repository.findById(id);
  if (!object || object.status !== "READY") throw new NotFoundError("Stored object not found.");
  return {
    object: toResponse(object),
    url: await createDownloadUrl({
      scope: object.scope,
      objectKey: object.objectKey,
      fileName: object.originalFileName,
    }),
  };
}

export async function assertAttachableStoredObject(id, purpose) {
  if (id == null) return null;
  requireR2();
  const field = {
    COURSE_THUMBNAIL: "thumbnailObjectId",
    SESSION_RECORDING: "recordingObjectId",
    SESSION_MATERIAL: "materialObjectId",
    PROJECT_THUMBNAIL: "thumbnailObjectId",
  }[purpose];
  const parsedId = parse(storedObjectIdSchema, id);
  const object = await repository.findById(parsedId);
  if (!object || object.status !== "READY") {
    throw new ValidationError("Select a completed upload.", field);
  }
  if (object.purpose !== purpose) {
    throw new ValidationError("The uploaded file has the wrong purpose.", field);
  }
  return object;
}

export function toStoredObjectResponse(object) {
  return object ? toResponse(object) : null;
}

export async function privateStoredObjectUrl(object) {
  if (!object) return null;
  if (object.status !== "READY" || object.scope !== "PRIVATE") return null;
  return createDownloadUrl({
    scope: object.scope,
    objectKey: object.objectKey,
    fileName: object.originalFileName,
  });
}
