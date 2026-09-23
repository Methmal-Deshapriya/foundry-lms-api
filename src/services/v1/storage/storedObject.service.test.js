import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/r2.js", () => ({
  createDownloadUrl: vi.fn(),
  createUploadUrl: vi.fn(),
  getR2Config: vi.fn(() => ({ uploadTtlSeconds: 300 })),
  inspectObject: vi.fn(),
  isR2Enabled: vi.fn(() => true),
  publicObjectUrl: vi.fn((key) => `https://assets.example.com/${key}`),
}));
vi.mock("../../../repositories/v1/storage/storedObject.repository.js", () => ({
  create: vi.fn(),
  findById: vi.fn(),
  markReady: vi.fn(),
  markFailed: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as r2 from "../../../config/r2.js";
import * as repository from "../../../repositories/v1/storage/storedObject.repository.js";
import {
  assertAttachableStoredObject,
  completeUploadService,
  createUploadIntentService,
  privateStoredObjectUrl,
} from "./storedObject.service.js";

const id = "10000000-0000-4000-8000-000000000001";
const pendingObject = {
  id,
  objectKey: `course-thumbnails/2026/09/${id}.webp`,
  scope: "PUBLIC",
  purpose: "COURSE_THUMBNAIL",
  status: "PENDING",
  originalFileName: "course.webp",
  contentType: "image/webp",
  declaredSizeBytes: 1024n,
  actualSizeBytes: null,
  etag: null,
  uploadedByUserId: "actor-1",
  readyAt: null,
  createdAt: new Date("2026-09-23T00:00:00.000Z"),
};

describe("stored-object service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2.isR2Enabled.mockReturnValue(true);
    r2.getR2Config.mockReturnValue({ uploadTtlSeconds: 300 });
  });

  it("creates a constrained public thumbnail upload intent", async () => {
    repository.create.mockImplementation(async (data) => ({
      ...pendingObject,
      ...data,
      createdAt: pendingObject.createdAt,
    }));
    r2.createUploadUrl.mockResolvedValue("https://signed-upload.example");

    const result = await createUploadIntentService(
      {
        purpose: "COURSE_THUMBNAIL",
        fileName: "course.webp",
        contentType: "image/webp",
        sizeBytes: 1024,
      },
      "actor-1",
      "ADMIN",
    );

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      scope: "PUBLIC",
      purpose: "COURSE_THUMBNAIL",
      declaredSizeBytes: 1024n,
    }));
    expect(result.upload).toMatchObject({
      method: "PUT",
      url: "https://signed-upload.example",
      headers: { "Content-Type": "image/webp" },
    });
  });

  it("rejects a MIME type outside the purpose allowlist", async () => {
    await expect(createUploadIntentService({
      purpose: "COURSE_THUMBNAIL",
      fileName: "payload.svg",
      contentType: "image/svg+xml",
      sizeBytes: 1024,
    }, "actor-1", "ADMIN")).rejects.toMatchObject({ statusCode: 400, field: "contentType" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("rejects a student uploading a purpose reserved for admins", async () => {
    await expect(createUploadIntentService({
      purpose: "COURSE_THUMBNAIL",
      fileName: "course.webp",
      contentType: "image/webp",
      sizeBytes: 1024,
    }, "actor-1", "STUDENT")).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("allows a student to create an upload intent for their own project thumbnail", async () => {
    repository.create.mockImplementation(async (data) => ({
      ...pendingObject,
      ...data,
      purpose: "PROJECT_THUMBNAIL",
      createdAt: pendingObject.createdAt,
    }));
    r2.createUploadUrl.mockResolvedValue("https://signed-upload.example");

    await expect(createUploadIntentService({
      purpose: "PROJECT_THUMBNAIL",
      fileName: "project.webp",
      contentType: "image/webp",
      sizeBytes: 1024,
    }, "actor-1", "STUDENT")).resolves.toMatchObject({
      object: expect.objectContaining({ purpose: "PROJECT_THUMBNAIL" }),
    });
  });

  it("finalizes only after R2 metadata matches the declared upload", async () => {
    repository.findById.mockResolvedValue(pendingObject);
    r2.inspectObject.mockResolvedValue({
      ContentLength: 1024,
      ContentType: "image/webp",
      ETag: '"abc123"',
    });
    repository.markReady.mockImplementation(async (_id, data) => ({
      ...pendingObject,
      ...data,
      status: "READY",
      readyAt: new Date(),
    }));

    const result = await completeUploadService(id, "actor-1");

    expect(repository.markReady).toHaveBeenCalledWith(id, {
      actualSizeBytes: 1024n,
      etag: "abc123",
    });
    expect(result).toMatchObject({ status: "READY", sizeBytes: 1024 });
  });

  it("refuses to complete another user's pending upload unless the actor is an admin", async () => {
    repository.findById.mockResolvedValue(pendingObject);
    await expect(
      completeUploadService(id, "someone-else", "STUDENT"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it("does not finalize a truncated or substituted upload", async () => {
    repository.findById.mockResolvedValue(pendingObject);
    r2.inspectObject.mockResolvedValue({ ContentLength: 10, ContentType: "image/webp" });
    await expect(completeUploadService(id, "actor-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "UPLOAD_SIZE_MISMATCH",
    });
    expect(repository.markReady).not.toHaveBeenCalled();
  });

  it("rejects attaching a ready object to the wrong entity field", async () => {
    repository.findById.mockResolvedValue({ ...pendingObject, status: "READY" });
    await expect(assertAttachableStoredObject(id, "SESSION_MATERIAL")).rejects.toMatchObject({
      statusCode: 400,
      field: "materialObjectId",
    });
  });

  it("signs private objects only when they are ready", async () => {
    const object = {
      ...pendingObject,
      scope: "PRIVATE",
      purpose: "SESSION_MATERIAL",
      status: "READY",
    };
    r2.createDownloadUrl.mockResolvedValue("https://signed-download.example");
    await expect(privateStoredObjectUrl(object)).resolves.toBe("https://signed-download.example");
    expect(r2.createDownloadUrl).toHaveBeenCalledWith(expect.objectContaining({
      scope: "PRIVATE",
      objectKey: object.objectKey,
    }));
  });
});
