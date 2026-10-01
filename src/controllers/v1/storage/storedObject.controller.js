import { timingSafeEqual } from "node:crypto";
import * as service from "../../../services/v1/storage/storedObject.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function createUploadIntent(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await service.createUploadIntentService(req.body, req.user.id, req.user.role),
      "Upload intent created",
      201,
    );
  } catch (error) {
    next(error);
  }
}

export async function completeUpload(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await service.completeUploadService(req.params.id, req.user.id, req.user.role),
      "Upload completed",
    );
  } catch (error) {
    next(error);
  }
}

export async function getObjectAccess(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await service.getStoredObjectAccessService(req.params.id),
      "Object access granted",
    );
  } catch (error) {
    next(error);
  }
}

// Super admin, from the admin UI: preview (dryRun) or run.
export async function runCleanup(req, res, next) {
  try {
    const result = await service.cleanupStorageService({ dryRun: req.body?.dryRun !== false, actorId: req.user.id });
    return ApiResponse.send(res, result, result.dryRun ? "Cleanup preview ready" : "Storage cleaned up");
  } catch (error) {
    next(error);
  }
}

// Daily GitHub Actions job: authorised by a shared secret header, not a login.
export async function runScheduledCleanup(req, res, next) {
  try {
    const expected = process.env.STORAGE_CLEANUP_SECRET?.trim();
    const given = String(req.get("x-cleanup-secret") ?? "");
    const ok =
      Boolean(expected) &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    const result = await service.cleanupStorageService({ dryRun: false });
    return ApiResponse.send(res, result, "Storage cleaned up");
  } catch (error) {
    next(error);
  }
}
