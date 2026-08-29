import * as service from "../../../services/v1/catalog/course.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function getCoursesAdmin(req, res, next) { try { return ApiResponse.send(res, await service.getCoursesAdminService(req.query)); } catch (error) { next(error); } }
export async function getCourseAdmin(req, res, next) { try { return ApiResponse.send(res, await service.getCourseAdminService(req.params.id)); } catch (error) { next(error); } }
export async function getCourseDeletionImpact(req, res, next) { try { return ApiResponse.send(res, await service.getCourseDeletionImpactService(req.params.id)); } catch (error) { next(error); } }
export async function createCourse(req, res, next) { try { return ApiResponse.send(res, await service.createCourseService(req.body, req.user.id), "Course intake created", 201); } catch (error) { next(error); } }
export async function updateCourse(req, res, next) { try { return ApiResponse.send(res, await service.updateCourseService(req.params.id, req.body, req.user.id)); } catch (error) { next(error); } }
export async function updateCourseStatus(req, res, next) { try { return ApiResponse.send(res, await service.updateCourseStatusService(req.params.id, req.body, req.user)); } catch (error) { next(error); } }
export async function deleteCoursePermanently(req, res, next) { try { return ApiResponse.send(res, await service.deleteCoursePermanentlyService(req.params.id, req.user.id)); } catch (error) { next(error); } }
