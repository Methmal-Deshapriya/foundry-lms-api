import * as service from "../../../services/v1/catalog/courseGroup.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function list(req, res, next) { try { return ApiResponse.send(res, await service.listCourseGroupsService(req.query)); } catch (error) { next(error); } }
export async function get(req, res, next) { try { return ApiResponse.send(res, await service.getCourseGroupService(req.params.id)); } catch (error) { next(error); } }
export async function deletionImpact(req, res, next) { try { return ApiResponse.send(res, await service.getCourseGroupDeletionImpactService(req.params.id)); } catch (error) { next(error); } }
export async function create(req, res, next) { try { return ApiResponse.send(res, await service.createCourseGroupService(req.body, req.user.id), "Course group created", 201); } catch (error) { next(error); } }
export async function update(req, res, next) { try { return ApiResponse.send(res, await service.updateCourseGroupService(req.params.id, req.body, req.user.id)); } catch (error) { next(error); } }
export async function archive(req, res, next) { try { return ApiResponse.send(res, await service.setCourseGroupArchivedService(req.params.id, true, req.user.id)); } catch (error) { next(error); } }
export async function restore(req, res, next) { try { return ApiResponse.send(res, await service.setCourseGroupArchivedService(req.params.id, false, req.user.id)); } catch (error) { next(error); } }
export async function remove(req, res, next) { try { return ApiResponse.send(res, await service.deleteCourseGroupService(req.params.id, req.user.id)); } catch (error) { next(error); } }
