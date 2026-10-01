import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/v1/storage/storedObject.service.js", () => ({
  cleanupStorageService: vi.fn(async () => ({ dryRun: false, deleted: 0, hasMore: false })),
}));

import * as service from "../../../services/v1/storage/storedObject.service.js";
import { runScheduledCleanup } from "./storedObject.controller.js";

function call(secretHeader) {
  const req = { get: (name) => (name.toLowerCase() === "x-cleanup-secret" ? secretHeader : undefined) };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const next = vi.fn();
  return runScheduledCleanup(req, res, next).then(() => ({ res, next }));
}

// The nightly GitHub Actions job is the only caller; anything else must look
// like the route doesn't exist and never trigger a deletion (M04-11).
describe("scheduled storage cleanup", () => {
  const previous = process.env.STORAGE_CLEANUP_SECRET;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STORAGE_CLEANUP_SECRET = "a-long-random-cleanup-secret";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.STORAGE_CLEANUP_SECRET;
    else process.env.STORAGE_CLEANUP_SECRET = previous;
  });

  it.each([["a wrong secret", "nope"], ["no secret", undefined], ["a prefix of the secret", "a-long-random"]])("answers 404 to %s", async (_label, header) => {
    const { res } = await call(header);
    expect(res.statusCode).toBe(404);
    expect(service.cleanupStorageService).not.toHaveBeenCalled();
  });

  it("answers 404 when the server has no secret configured", async () => {
    delete process.env.STORAGE_CLEANUP_SECRET;
    const { res } = await call("");
    expect(res.statusCode).toBe(404);
    expect(service.cleanupStorageService).not.toHaveBeenCalled();
  });

  it("runs a real (not dry-run) cleanup with the right secret", async () => {
    await call("a-long-random-cleanup-secret");
    expect(service.cleanupStorageService).toHaveBeenCalledWith({ dryRun: false });
  });
});
