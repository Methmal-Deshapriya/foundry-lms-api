import * as bootcampService from "../../../services/v1/bootcamps/bootcamp.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Bootcamp Controller - The "Service Desk"
 * Handles HTTP requests for course marketplace and management.
 */

/* --- Public Controllers --- */

/**
 * Controller: Get all published bootcamps.
 */
export async function getAllPublicBootcampsController(req, res, next) {
  try {
    const bootcamps = await bootcampService.getAllPublicBootcampsService();
    return ApiResponse.send(res, bootcamps, "Public bootcamps fetched successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get a single bootcamp by its slug.
 */
export async function getBootcampBySlugController(req, res, next) {
  try {
    const { slug } = req.params;
    const bootcamp = await bootcampService.getBootcampBySlugService(slug);
    return ApiResponse.send(res, bootcamp, "Bootcamp details fetched successfully");
  } catch (error) {
    next(error);
  }
}

/* --- Admin Controllers --- */

/**
 * Controller: Get all bootcamps (Admin view).
 */
export async function getAllAdminBootcampsController(req, res, next) {
  try {
    const bootcamps = await bootcampService.getAllAdminBootcampsService();
    return ApiResponse.send(res, bootcamps, "All bootcamps fetched for administration");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Create a new bootcamp.
 */
export async function createBootcampController(req, res, next) {
  try {
    const actorId = req.user.id;
    const bootcamp = await bootcampService.createBootcampService(req.body, actorId);
    return ApiResponse.send(res, bootcamp, "Bootcamp created successfully", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Update a bootcamp.
 * (Audit logging for updates can be added later if needed)
 */
export async function updateBootcampController(req, res, next) {
  try {
    const { id } = req.params;
    const bootcamp = await bootcampService.updateBootcampService(id, req.body);
    return ApiResponse.send(res, bootcamp, "Bootcamp updated successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Delete a bootcamp.
 */
export async function deleteBootcampController(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    await bootcampService.deleteBootcampService(id, actorId);
    return ApiResponse.send(res, null, "Bootcamp deleted successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Publish a bootcamp.
 */
export async function publishBootcampController(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    const bootcamp = await bootcampService.togglePublishService(id, true, actorId);
    return ApiResponse.send(res, bootcamp, "Bootcamp published successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Unpublish a bootcamp.
 */
export async function unpublishBootcampController(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    const bootcamp = await bootcampService.togglePublishService(id, false, actorId);
    return ApiResponse.send(res, bootcamp, "Bootcamp unpublished successfully");
  } catch (error) {
    next(error);
  }
}
