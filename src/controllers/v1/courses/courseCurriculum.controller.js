import * as curriculumService from "../../../services/v1/courses/courseCurriculum.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function getCurriculum(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await curriculumService.getCourseCurriculumService(req.params.courseId, req.query),
      "Course curriculum fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function attachSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await curriculumService.attachCourseSessionService(
        req.params.courseId,
        req.body,
        req.user.id,
      ),
      "Session attached to course curriculum",
      201,
    );
  } catch (error) {
    next(error);
  }
}

export async function reorderCurriculum(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await curriculumService.reorderCourseCurriculumService(
        req.params.courseId,
        req.body,
        req.user.id,
      ),
      "Course curriculum reordered",
    );
  } catch (error) {
    next(error);
  }
}

export async function removeSession(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await curriculumService.removeCourseSessionService(
        req.params.courseId,
        req.params.courseSessionId,
        req.user.id,
      ),
      "Course curriculum updated",
    );
  } catch (error) {
    next(error);
  }
}

