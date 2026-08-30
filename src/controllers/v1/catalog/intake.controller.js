import * as service from "../../../services/v1/catalog/intake.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function list(req, res, next) { try { return ApiResponse.send(res, await service.listIntakesAdminService({ ...req.query, courseId: req.params.courseId ?? req.query.courseId })); } catch (error) { next(error); } }
export async function get(req, res, next) { try { return ApiResponse.send(res, await service.getIntakeAdminService(req.params.id)); } catch (error) { next(error); } }
export async function defaults(req, res, next) { try { return ApiResponse.send(res, await service.getIntakeDefaultsService(req.params.courseId)); } catch (error) { next(error); } }
export async function deletionImpact(req, res, next) { try { return ApiResponse.send(res, await service.getIntakeDeletionImpactService(req.params.id)); } catch (error) { next(error); } }
export async function analytics(req, res, next) { try { return ApiResponse.send(res, await service.getIntakeAnalyticsService(req.params.id)); } catch (error) { next(error); } }
export async function create(req, res, next) { try { return ApiResponse.send(res, await service.createIntakeService(req.params.courseId, req.body, req.user.id), "Intake created", 201); } catch (error) { next(error); } }
export async function update(req, res, next) { try { return ApiResponse.send(res, await service.updateIntakeService(req.params.id, req.body, req.user.id)); } catch (error) { next(error); } }
export async function updateStatus(req, res, next) { try { return ApiResponse.send(res, await service.updateIntakeStatusService(req.params.id, req.body, req.user)); } catch (error) { next(error); } }
export async function remove(req, res, next) { try { return ApiResponse.send(res, await service.deleteIntakePermanentlyService(req.params.id, req.user.id)); } catch (error) { next(error); } }
