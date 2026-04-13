import * as bootcampRepo from "../../../repositories/v1/bootcamps/bootcamp.repository.js";
import * as bootcampModel from "../../../models/v1/bootcamps/bootcamp.model.js";
import { createBootcampSchema, updateBootcampSchema } from "../../../constants/v1/bootcamps/bootcamp.schema.js";
import { ValidationError, NotFoundError } from "../../../utils/Errors.js";

/**
 * Bootcamp Service - The "Brain"
 * Orchestrates business logic for bootcamp management and marketplace.
 */

/* --- Public Services --- */

/**
 * Service: Get all published bootcamps for the marketplace.
 * @returns {Promise<Array>} List of sanitized public bootcamps.
 */
export async function getAllPublicBootcampsService() {
  const bootcamps = await bootcampRepo.findAllPublic();
  return bootcampModel.toPublicBootcampListResponse(bootcamps);
}

/**
 * Service: Get a single bootcamp by its slug.
 * @param {string} slug - The URL-friendly identifier.
 * @returns {Promise<object>} The sanitized public bootcamp.
 */
export async function getBootcampBySlugService(slug) {
  const bootcamp = await bootcampRepo.findBySlug(slug);

  // Security Check: If it doesn't exist OR isn't published, don't show it to the public.
  if (!bootcamp || !bootcamp.isPublished) {
    throw new NotFoundError("Bootcamp not found or currently unavailable.");
  }

  return bootcampModel.toPublicBootcampResponse(bootcamp);
}

/* --- Admin Services --- */

/**
 * Service: Get all bootcamps for administrative management.
 * @returns {Promise<Array>} List of full bootcamp records.
 */
export async function getAllAdminBootcampsService() {
  const bootcamps = await bootcampRepo.findAllAdmin();
  return bootcampModel.toAdminBootcampListResponse(bootcamps);
}

/**
 * Service: Create a new bootcamp.
 * @param {object} data - The course details.
 * @returns {Promise<object>} The created and sanitized bootcamp.
 */
export async function createBootcampService(data) {
  // 1. Validate the input blueprint
  const validation = createBootcampSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Save to database
  const newBootcamp = await bootcampRepo.create(validation.data);

  // 3. Return sanitized response
  return bootcampModel.toAdminBootcampResponse(newBootcamp);
}

/**
 * Service: Update an existing bootcamp.
 * @param {string} id - UUID of the course.
 * @param {object} data - Fields to update.
 * @returns {Promise<object>} The updated and sanitized bootcamp.
 */
export async function updateBootcampService(id, data) {
  // 1. Validate the input blueprint (everything is optional in update)
  const validation = updateBootcampSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Perform the update
  const updatedBootcamp = await bootcampRepo.update(id, validation.data);

  return bootcampModel.toAdminBootcampResponse(updatedBootcamp);
}

/**
 * Service: Delete a bootcamp.
 * @param {string} id - UUID of the course to remove.
 */
export async function deleteBootcampService(id) {
  // 1. Check existence before deleting
  const bootcamp = await bootcampRepo.findById(id);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }

  // 2. Perform removal
  return await bootcampRepo.remove(id);
}

/**
 * Service: Publish or Unpublish a bootcamp.
 * @param {string} id - UUID of the course.
 * @param {boolean} isPublished - The new visibility state.
 * @returns {Promise<object>} The updated bootcamp.
 */
export async function togglePublishService(id, isPublished) {
  const updatedBootcamp = await bootcampRepo.update(id, { isPublished });
  return bootcampModel.toAdminBootcampResponse(updatedBootcamp);
}
