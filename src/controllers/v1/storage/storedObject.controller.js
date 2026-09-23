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
