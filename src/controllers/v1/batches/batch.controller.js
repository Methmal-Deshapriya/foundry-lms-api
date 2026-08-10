import * as batchService from "../../../services/v1/batches/batch.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function listCourseBatches(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.listCourseBatchesService(req.params.courseId, req.query),
      "Batches fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function createBatch(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.createBatchService(
        req.params.courseId,
        req.body,
        req.user.id,
      ),
      "Batch created successfully",
      201,
    );
  } catch (error) {
    next(error);
  }
}

export async function getBatch(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.getBatchService(req.params.id),
      "Batch fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function updateBatch(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.updateBatchService(req.params.id, req.body, req.user.id),
      "Batch updated successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function updateBatchStatus(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.updateBatchStatusService(
        req.params.id,
        req.body,
        req.user.id,
      ),
      "Batch status updated",
    );
  } catch (error) {
    next(error);
  }
}

export async function getBatchSessions(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.getBatchSessionsService(req.params.id),
      "Batch sessions fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function updateBatchSessionDelivery(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.updateBatchSessionDeliveryService(
        req.params.id,
        req.params.courseSessionId,
        req.body,
        req.user.id,
      ),
      "Batch session delivery updated",
    );
  } catch (error) {
    next(error);
  }
}
