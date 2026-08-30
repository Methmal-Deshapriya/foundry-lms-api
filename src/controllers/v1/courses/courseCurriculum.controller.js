import * as curriculumService from "../../../services/v1/courses/courseCurriculum.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function getCurriculum(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await curriculumService.getCourseCurriculumService(req.params.intakeId, req.query),
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
        req.params.intakeId,
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
        req.params.intakeId,
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
        req.params.intakeId,
        req.params.courseSessionId,
        req.user.id,
      ),
      "Course curriculum updated",
    );
  } catch (error) {
    next(error);
  }
}

export async function updateDelivery(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await curriculumService.updateCourseSessionDeliveryService(
        req.params.intakeId,
        req.params.courseSessionId,
        req.body,
        req.user.id,
      ),
      "Course session delivery updated",
    );
  } catch (error) { next(error); }
}
