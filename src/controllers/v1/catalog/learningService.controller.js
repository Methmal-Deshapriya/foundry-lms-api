import * as service from "../../../services/v1/catalog/learningService.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function list(req, res, next) { try { return ApiResponse.send(res, await service.listLearningServicesService(req.query), "Learning services fetched successfully"); } catch (error) { next(error); } }
export async function listPublic(req, res, next) { try { return ApiResponse.send(res, await service.listPublicLearningServicesService(), "Learning services fetched successfully"); } catch (error) { next(error); } }
export async function get(req, res, next) { try { return ApiResponse.send(res, await service.getLearningServiceService(req.params.id), "Learning service fetched successfully"); } catch (error) { next(error); } }
export async function create(req, res, next) { try { return ApiResponse.send(res, await service.createLearningServiceService(req.body, req.user.id), "Learning service created successfully", 201); } catch (error) { next(error); } }
export async function update(req, res, next) { try { return ApiResponse.send(res, await service.updateLearningServiceService(req.params.id, req.body, req.user.id), "Learning service updated successfully"); } catch (error) { next(error); } }
export async function activate(req, res, next) { try { return ApiResponse.send(res, await service.transitionLearningServiceStatusService(req.params.id, "ACTIVE", req.body, req.user.id), "Learning service activated successfully"); } catch (error) { next(error); } }
export async function deactivate(req, res, next) { try { return ApiResponse.send(res, await service.transitionLearningServiceStatusService(req.params.id, "DRAFT", req.body, req.user.id), "Learning service deactivated successfully"); } catch (error) { next(error); } }
export async function archive(req, res, next) { try { return ApiResponse.send(res, await service.transitionLearningServiceStatusService(req.params.id, "ARCHIVED", req.body, req.user.id), "Learning service archived successfully"); } catch (error) { next(error); } }
export async function restore(req, res, next) { try { return ApiResponse.send(res, await service.transitionLearningServiceStatusService(req.params.id, "DRAFT", req.body, req.user.id), "Learning service restored as Draft"); } catch (error) { next(error); } }
export async function deletionImpact(req, res, next) { try { return ApiResponse.send(res, await service.getLearningServiceDeletionImpactService(req.params.id), "Learning service deletion impact fetched successfully"); } catch (error) { next(error); } }
export async function remove(req, res, next) { try { return ApiResponse.send(res, await service.deleteLearningServiceService(req.params.id, req.user.id), "Learning service permanently deleted"); } catch (error) { next(error); } }
