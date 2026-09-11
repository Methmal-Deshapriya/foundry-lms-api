import * as sessionService from "../../../services/v1/sessions/sessionLibrary.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function listSessions(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.listSessionLibraryService(req.query),
      "Session library fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function getSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.getSessionLibraryItemService(req.params.id),
      "Session fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function createSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.createSessionLibraryItemService(req.body, req.user.id),
      "Session created successfully",
      201,
    );
  } catch (error) {
    next(error);
  }
}

export async function updateSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.updateSessionLibraryItemService(
        req.params.id,
        req.body,
        req.user.id,
      ),
      "Session updated successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function archiveSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.archiveSessionLibraryItemService(req.params.id, req.user.id),
      "Session archived successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function unarchiveSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.unarchiveSessionLibraryItemService(req.params.id, req.user.id),
      "Session restored as a draft",
    );
  } catch (error) {
    next(error);
  }
}

export async function duplicateSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.duplicateSessionLibraryItemService(req.params.id, req.user.id),
      "Session duplicated as a new draft",
      201,
    );
  } catch (error) {
    next(error);
  }
}

export async function bulkArchiveSessions(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.bulkArchiveSessionLibraryItemsService(req.body, req.user.id),
      "Bulk archive request processed",
    );
  } catch (error) {
    next(error);
  }
}

export async function deleteSessionPermanently(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await sessionService.deleteSessionLibraryItemPermanentlyService(
        req.params.id,
        req.user.id,
      ),
      "Session permanently deleted",
    );
  } catch (error) {
    next(error);
  }
}

