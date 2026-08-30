import * as service from "../../../services/v1/enrollments/enrollmentRequest.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function create(req, res, next) {
  try {
    return ApiResponse.send(res, await service.createEnrollmentRequestService(req.params.courseId, req.body, req.user), "Enrollment request submitted", 201);
  } catch (error) { next(error); }
}

export async function listForIntake(req, res, next) {
  try {
    return ApiResponse.send(res, await service.listEnrollmentRequestsForIntakeService(req.params.intakeId, req.query));
  } catch (error) { next(error); }
}

export async function get(req, res, next) {
  try {
    return ApiResponse.send(res, await service.getEnrollmentRequestAdminService(req.params.id));
  } catch (error) { next(error); }
}

export async function updateStatus(req, res, next) {
  try {
    return ApiResponse.send(res, await service.updateEnrollmentRequestStatusService(req.params.id, req.body, req.user.id));
  } catch (error) { next(error); }
}

export async function enroll(req, res, next) {
  try {
    return ApiResponse.send(res, await service.enrollFromRequestService(req.params.id, req.body, req.user.id), "Student enrolled from request", 201);
  } catch (error) { next(error); }
}
