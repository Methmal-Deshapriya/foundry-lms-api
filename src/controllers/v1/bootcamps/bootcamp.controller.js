import * as bootcampService from "../../../services/v1/bootcamps/bootcamp.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Bootcamp Controller - The "Service Desk"
 * Handles HTTP requests for course marketplace and management.
 */

/* --- Public Controllers --- */

/**
 * Controller: Get all published bootcamps.
 * GET /v1/bootcamps
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
 * GET /v1/bootcamps/:slug
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
 * GET /v1/bootcamps/admin
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
 * POST /v1/bootcamps
 */
export async function createBootcampController(req, res, next) {
  try {
    const bootcamp = await bootcampService.createBootcampService(req.body);
    return ApiResponse.send(res, bootcamp, "Bootcamp created successfully", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Update a bootcamp.
 * PATCH /v1/bootcamps/:id
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
 * DELETE /v1/bootcamps/:id
 */
export async function deleteBootcampController(req, res, next) {
  try {
    const { id } = req.params;
    await bootcampService.deleteBootcampService(id);
    return ApiResponse.send(res, null, "Bootcamp deleted successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Publish a bootcamp.
 * PATCH /v1/bootcamps/:id/publish
 */
export async function publishBootcampController(req, res, next) {
  try {
    const { id } = req.params;
    const bootcamp = await bootcampService.togglePublishService(id, true);
    return ApiResponse.send(res, bootcamp, "Bootcamp published successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Unpublish a bootcamp.
 * PATCH /v1/bootcamps/:id/unpublish
 */
export async function unpublishBootcampController(req, res, next) {
  try {
    const { id } = req.params;
    const bootcamp = await bootcampService.togglePublishService(id, false);
    return ApiResponse.send(res, bootcamp, "Bootcamp unpublished successfully");
  } catch (error) {
    next(error);
  }
}
