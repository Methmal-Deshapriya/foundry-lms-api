import * as enrollmentService from "../../../services/v1/enrollments/enrollment.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function enrollStudentInCourseController(req, res, next) {
  try {
    const enrollment = await enrollmentService.enrollStudentInCourseService(
      req.params.intakeId,
      req.body,
      req.user.id,
    );
    return ApiResponse.send(res, enrollment, "Student enrolled successfully", 201);
  } catch (error) {
    next(error);
  }
}

export async function bulkEnrollStudentsInCourseController(req, res, next) {
  try {
    const result = await enrollmentService.bulkEnrollStudentsInCourseService(
      req.params.intakeId,
      req.body,
      req.user.id,
    );
    return ApiResponse.send(res, result, "Bulk enrollment request processed");
  } catch (error) {
    next(error);
  }
}

export async function selfEnrollFreeCourseController(req, res, next) {
  try {
    const result = await enrollmentService.selfEnrollFreeCourseService(
      req.params.intakeId,
      req.user,
    );
    return ApiResponse.send(
      res,
      result.enrollment,
      result.created
        ? "Course added to your learning dashboard"
        : result.reactivated
          ? "Course restored to your learning dashboard"
          : "You are already enrolled",
      result.created ? 201 : 200,
    );
  } catch (error) {
    next(error);
  }
}

export async function updateEnrollmentController(req, res, next) {
  try {
    const enrollment = await enrollmentService.updateEnrollmentService(
      req.params.id,
      req.body,
      req.user.id,
    );
    return ApiResponse.send(res, enrollment, "Enrollment updated successfully");
  } catch (error) {
    next(error);
  }
}

export async function completePaymentController(req, res, next) {
  try {
    const enrollment = await enrollmentService.completePaymentService(
      req.params.id,
      req.user.id,
    );
    return ApiResponse.send(res, enrollment, "Remaining payment recorded");
  } catch (error) {
    next(error);
  }
}

export async function getMyEnrollmentsController(req, res, next) {
  try {
    const enrollments = await enrollmentService.getMyEnrollmentsService(
      req.user.id,
      req.query,
    );
    return ApiResponse.send(res, enrollments, "Your enrollments fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getCourseEnrollmentsController(req, res, next) {
  try {
    const enrollments = await enrollmentService.getCourseEnrollmentsService(
      req.params.intakeId,
      req.query,
    );
    return ApiResponse.send(res, enrollments, "Course roster fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getCourseStudentsController(req, res, next) {
  try {
    const students = await enrollmentService.getCourseStudentsService(
      req.params.intakeId,
      req.query,
    );
    return ApiResponse.send(res, students, "Course enrollment list fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getEligibleStudentsForCourseController(req, res, next) {
  try {
    const students = await enrollmentService.getEligibleStudentsForCourseService(
      req.params.intakeId,
      req.query,
    );
    return ApiResponse.send(res, students, "Eligible students fetched successfully");
  } catch (error) {
    next(error);
  }
}
