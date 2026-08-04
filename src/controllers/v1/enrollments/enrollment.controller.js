import * as enrollmentService from "../../../services/v1/enrollments/enrollment.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function enrollStudentController(req, res, next) {
  try {
    const enrollment = await enrollmentService.enrollStudentService(req.body, req.user.id);
    return ApiResponse.send(res, enrollment, "Student enrolled successfully", 201);
  } catch (error) { next(error); }
}

export async function selfEnrollFreeCourseController(req, res, next) {
  try {
    const result = await enrollmentService.selfEnrollFreeCourseService(
      req.params.courseId,
      req.user
    );
    return ApiResponse.send(
      res,
      result.enrollment,
      result.created ? "Course added to your learning dashboard" : "You are already enrolled",
      result.created ? 201 : 200
    );
  } catch (error) { next(error); }
}

export async function updateEnrollmentController(req, res, next) {
  try {
    const enrollment = await enrollmentService.updateEnrollmentService(
      req.params.id,
      req.body,
      req.user.id
    );
    return ApiResponse.send(res, enrollment, "Enrollment updated successfully");
  } catch (error) { next(error); }
}

export async function getMyEnrollmentsController(req, res, next) {
  try {
    const enrollments = await enrollmentService.getMyEnrollmentsService(req.user.id);
    return ApiResponse.send(res, enrollments, "Your enrollments fetched successfully");
  } catch (error) { next(error); }
}

export async function getCourseStudentsController(req, res, next) {
  try {
    const students = await enrollmentService.getCourseStudentsService(req.params.courseId);
    return ApiResponse.send(res, students, "Course student list fetched successfully");
  } catch (error) { next(error); }
}

export async function getEligibleStudentsForCourseController(req, res, next) {
  try {
    const students = await enrollmentService.getEligibleStudentsForCourseService(
      req.params.courseId,
      req.query.q ?? "",
      req.query.limit ?? 5
    );
    return ApiResponse.send(res, students, "Eligible students fetched successfully");
  } catch (error) { next(error); }
}
