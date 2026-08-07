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

export async function initializeCurriculum(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.initializeBatchCurriculumService(req.params.id, req.user.id),
      "Batch curriculum initialized",
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

export async function upsertBatchSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.upsertBatchSessionService(
        req.params.id,
        req.params.courseSessionId,
        req.body,
        req.user.id,
      ),
      "Batch session updated",
    );
  } catch (error) {
    next(error);
  }
}

export async function reorderBatchSessions(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.reorderBatchSessionsService(
        req.params.id,
        req.body,
        req.user.id,
      ),
      "Batch sessions reordered",
    );
  } catch (error) {
    next(error);
  }
}

export async function removeBatchSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await batchService.removeBatchSessionService(
        req.params.id,
        req.params.courseSessionId,
        req.user.id,
      ),
      "Batch delivery updated",
    );
  } catch (error) {
    next(error);
  }
}

