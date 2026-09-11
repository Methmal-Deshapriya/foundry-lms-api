import * as service from "../../../services/v1/catalog/course.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function list(req, res, next) { try { return ApiResponse.send(res, await service.listCoursesAdminService(req.query)); } catch (error) { next(error); } }
export async function get(req, res, next) { try { return ApiResponse.send(res, await service.getCourseAdminService(req.params.id)); } catch (error) { next(error); } }
export async function deletionImpact(req, res, next) { try { return ApiResponse.send(res, await service.getCourseDeletionImpactService(req.params.id)); } catch (error) { next(error); } }
export async function analytics(req, res, next) { try { return ApiResponse.send(res, await service.getCourseAnalyticsService(req.params.id)); } catch (error) { next(error); } }
export async function create(req, res, next) { try { return ApiResponse.send(res, await service.createCourseService(req.body, req.user.id), "Course created", 201); } catch (error) { next(error); } }
export async function update(req, res, next) { try { return ApiResponse.send(res, await service.updateCourseService(req.params.id, req.body, req.user.id)); } catch (error) { next(error); } }
export async function archive(req, res, next) { try { return ApiResponse.send(res, await service.setCourseArchivedService(req.params.id, true, req.user.id)); } catch (error) { next(error); } }
export async function restore(req, res, next) { try { return ApiResponse.send(res, await service.setCourseArchivedService(req.params.id, false, req.user.id)); } catch (error) { next(error); } }
export async function remove(req, res, next) { try { return ApiResponse.send(res, await service.deleteCourseService(req.params.id, req.user.id)); } catch (error) { next(error); } }
