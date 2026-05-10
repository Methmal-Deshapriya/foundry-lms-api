import * as enrollmentService from "../../../services/v1/enrollments/enrollment.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Enrollment Controller - The "Access Manager"
 * Handles administrative and student requests for course access.
 */

/**
 * Controller: Manually enroll a student.
 */
export async function enrollStudentController(req, res, next) {
  try {
    const actorId = req.user.id;
    const enrollment = await enrollmentService.enrollStudentService(req.body, actorId);
    return ApiResponse.send(res, enrollment, "Student enrolled successfully", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Update enrollment status or payment (Admin).
 * PATCH /v1/enrollments/:id
 */
export async function updateEnrollmentController(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    const enrollment = await enrollmentService.updateEnrollmentService(id, req.body, actorId);
    return ApiResponse.send(res, enrollment, "Enrollment updated successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get the current student's enrolled bootcamps.
 */
export async function getMyEnrollmentsController(req, res, next) {
  try {
    const userId = req.user.id;
    const enrollments = await enrollmentService.getMyEnrollmentsService(userId);
    return ApiResponse.send(res, enrollments, "Your enrollments fetched successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get all students in a specific bootcamp (Admin).
 */
export async function getBootcampStudentsController(req, res, next) {
  try {
    const { bootcampId } = req.params;
    const students = await enrollmentService.getBootcampStudentsService(bootcampId);
    return ApiResponse.send(res, students, "Bootcamp student list fetched successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Search students eligible for manual enrollment in a bootcamp.
 */
export async function getEligibleStudentsForBootcampController(req, res, next) {
  try {
    const { bootcampId } = req.params;
    const { q = "", limit = 5 } = req.query;
    const students = await enrollmentService.getEligibleStudentsForBootcampService(
      bootcampId,
      q,
      Number(limit)
    );

    return ApiResponse.send(
      res,
      students,
      "Eligible students fetched successfully"
    );
  } catch (error) {
    next(error);
  }
}
