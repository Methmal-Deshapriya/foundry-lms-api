import * as classroomService from "../../../services/v1/learning/classroom.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function getClassroom(req, res, next) {
  try {
    const classroom = await classroomService.getClassroomService(
      req.params.enrollmentId,
      req.user,
    );
    return ApiResponse.send(res, classroom, "Classroom fetched successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * GET /enrollments/:enrollmentId/sessions/:courseSessionId/recording|material
 * Redirects to a freshly signed R2 link. The student's browser follows it
 * straight to the file; the link is never stored in a page (M07-01).
 */
export function getSessionFile(kind) {
  return async (req, res, next) => {
    try {
      const url = await classroomService.getSessionFileService(req.params.enrollmentId, req.params.courseSessionId, kind, req.user);
      res.set("Cache-Control", "no-store");
      return res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  };
}

export async function getSession(req, res, next) {
  try {
    const session = await classroomService.getClassroomSessionService(
      req.params.enrollmentId,
      req.params.courseSessionId,
      req.user,
    );
    return ApiResponse.send(res, session, "Session fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function completeSession(req, res, next) {
  try {
    const result = await classroomService.completeClassroomSessionService(
      req.params.enrollmentId,
      req.params.courseSessionId,
      req.user,
    );
    return ApiResponse.send(
      res,
      result,
      result.created ? "Session marked complete" : "Session was already complete",
      result.created ? 201 : 200,
    );
  } catch (error) {
    next(error);
  }
}

export async function uncompleteSession(req, res, next) {
  try {
    const result = await classroomService.uncompleteClassroomSessionService(
      req.params.enrollmentId,
      req.params.courseSessionId,
      req.user,
    );
    return ApiResponse.send(res, result, "Session completion removed");
  } catch (error) {
    next(error);
  }
}

export async function getProgress(req, res, next) {
  try {
    const progress = await classroomService.getProgressService(
      req.params.enrollmentId,
      req.user,
    );
    return ApiResponse.send(res, progress, "Progress fetched successfully");
  } catch (error) {
    next(error);
  }
}
