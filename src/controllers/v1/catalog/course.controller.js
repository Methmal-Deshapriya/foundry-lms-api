import * as courseService from "../../../services/v1/catalog/course.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function getCoursesAdmin(req, res, next) {
  try {
    return ApiResponse.send(res, await courseService.getCoursesAdminService(req.query));
  } catch (error) { next(error); }
}

export async function getCourseAdmin(req, res, next) {
  try {
    return ApiResponse.send(res, await courseService.getCourseAdminService(req.params.id));
  } catch (error) { next(error); }
}

export async function createCourse(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await courseService.createCourseService(req.body, req.user.id),
      "Course created successfully",
      201,
    );
  } catch (error) { next(error); }
}

export async function updateCourse(req, res, next) {
  try {
    return ApiResponse.send(res, await courseService.updateCourseService(req.params.id, req.body, req.user.id));
  } catch (error) { next(error); }
}

export async function publishCourse(req, res, next) {
  try {
    return ApiResponse.send(res, await courseService.setCoursePublicationService(req.params.id, true, req.user.id));
  } catch (error) { next(error); }
}

export async function unpublishCourse(req, res, next) {
  try {
    return ApiResponse.send(res, await courseService.setCoursePublicationService(req.params.id, false, req.user.id));
  } catch (error) { next(error); }
}

export async function archiveCourse(req, res, next) {
  try {
    return ApiResponse.send(res, await courseService.archiveCourseService(req.params.id, req.user.id));
  } catch (error) { next(error); }
}

export async function unarchiveCourse(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await courseService.unarchiveCourseService(req.params.id, req.user.id),
      "Course restored as a draft",
    );
  } catch (error) { next(error); }
}

export async function deleteCoursePermanently(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await courseService.deleteCoursePermanentlyService(req.params.id, req.user.id),
      "Course permanently deleted",
    );
  } catch (error) { next(error); }
}
