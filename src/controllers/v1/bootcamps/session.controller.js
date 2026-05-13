import * as sessionService from "../../../services/v1/bootcamps/session.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

/**
 * Session Controller
 */

export async function createSession(req, res, next) {
  try {
    const { bootcampId } = req.params;
    const actorId = req.user.id;
    const session = await sessionService.createSessionService(bootcampId, req.body, actorId);
    return ApiResponse.send(res, session, "Session created successfully", 201);
  } catch (error) {
    next(error);
  }
}

export async function updateSession(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    const session = await sessionService.updateSessionService(id, req.body, actorId);
    return ApiResponse.send(res, session, "Session updated successfully");
  } catch (error) {
    next(error);
  }
}

export async function deleteSession(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    await sessionService.deleteSessionService(id, actorId);
    return ApiResponse.send(res, null, "Session deleted successfully");
  } catch (error) {
    next(error);
  }
}

export async function reorderSessions(req, res, next) {
  try {
    const { bootcampId } = req.params;
    const actorId = req.user.id;
    await sessionService.reorderSessionsService(bootcampId, req.body, actorId);
    return ApiResponse.send(res, null, "Sessions reordered successfully");
  } catch (error) {
    next(error);
  }
}

export async function getBootcampSessions(req, res, next) {
  try {
    const { bootcampId } = req.params;
    const userId = req.user.id;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role);

    let sessions;
    if (isAdmin) {
      sessions = await sessionService.getSessionsAdminService(bootcampId);
    } else {
      sessions = await sessionService.getSessionsStudentService(bootcampId, userId);
    }

    return ApiResponse.send(res, sessions, "Sessions fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getSessionDetails(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role);

    const session = await sessionService.getSessionDetailsService(id, userId, isAdmin);
    return ApiResponse.send(res, session, "Session details fetched successfully");
  } catch (error) {
    next(error);
  }
}
