import * as bootcampRepo from "../../../repositories/v1/bootcamps/bootcamp.repository.js";
import * as bootcampModel from "../../../models/v1/bootcamps/bootcamp.model.js";
import { createBootcampSchema, updateBootcampSchema } from "../../../constants/v1/bootcamps/bootcamp.schema.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { ValidationError, NotFoundError } from "../../../utils/Errors.js";

/**
 * Bootcamp Service - The "Brain"
 * Orchestrates business logic for bootcamp management and marketplace.
 */

/* --- Public Services --- */

/**
 * Service: Get all published bootcamps for the marketplace.
 */
export async function getAllPublicBootcampsService() {
  const bootcamps = await bootcampRepo.findAllPublic();
  return bootcampModel.toPublicBootcampListResponse(bootcamps);
}

/**
 * Service: Get a single bootcamp by its slug.
 */
export async function getBootcampBySlugService(slug) {
  const bootcamp = await bootcampRepo.findBySlug(slug);

  if (!bootcamp || !bootcamp.isPublished) {
    throw new NotFoundError("Bootcamp not found or currently unavailable.");
  }

  return bootcampModel.toPublicBootcampResponse(bootcamp);
}

/* --- Admin Services --- */

/**
 * Service: Get all bootcamps for administrative management.
 */
export async function getAllAdminBootcampsService() {
  const bootcamps = await bootcampRepo.findAllAdmin();
  return bootcampModel.toAdminBootcampListResponse(bootcamps);
}

/**
 * Service: Create a new bootcamp.
 * @param {object} data - Course details.
 * @param {string} actorId - Admin creating the course.
 */
export async function createBootcampService(data, actorId) {
  const validation = createBootcampSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const newBootcamp = await bootcampRepo.create(validation.data);

  // --- Audit Log ---
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BOOTCAMP_CREATED,
    entityType: ENTITY_TYPES.BOOTCAMP,
    entityId: newBootcamp.id,
    description: `Bootcamp "${newBootcamp.title}" created by Admin ${actorId}`,
    metadata: { title: newBootcamp.title, slug: newBootcamp.slug, price: newBootcamp.price }
  });

  return bootcampModel.toAdminBootcampResponse(newBootcamp);
}

/**
 * Service: Update an existing bootcamp.
 * (Note: We'll keep updates simple for now, but can add more granular auditing later)
 */
export async function updateBootcampService(id, data) {
  const validation = updateBootcampSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const updatedBootcamp = await bootcampRepo.update(id, validation.data);
  return bootcampModel.toAdminBootcampResponse(updatedBootcamp);
}

/**
 * Service: Delete a bootcamp.
 * @param {string} id - Course ID.
 * @param {string} actorId - Admin deleting the course.
 */
export async function deleteBootcampService(id, actorId) {
  const bootcamp = await bootcampRepo.findById(id);
  if (!bootcamp) {
    throw new NotFoundError("Bootcamp not found.");
  }

  const result = await bootcampRepo.remove(id);

  // --- Audit Log ---
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.BOOTCAMP_DELETED,
    entityType: ENTITY_TYPES.BOOTCAMP,
    entityId: id,
    description: `Bootcamp "${bootcamp.title}" deleted by Admin ${actorId}`,
    metadata: { title: bootcamp.title, slug: bootcamp.slug }
  });

  return result;
}

/**
 * Service: Publish or Unpublish a bootcamp.
 * @param {string} id - Course ID.
 * @param {boolean} isPublished - The new state.
 * @param {string} actorId - Admin toggling visibility.
 */
export async function togglePublishService(id, isPublished, actorId) {
  const updatedBootcamp = await bootcampRepo.update(id, { isPublished });

  // --- Audit Log ---
  const action = isPublished ? AUDIT_ACTIONS.BOOTCAMP_PUBLISHED : AUDIT_ACTIONS.BOOTCAMP_UNPUBLISHED;
  
  recordActionService({
    actorUserId: actorId,
    action: action,
    entityType: ENTITY_TYPES.BOOTCAMP,
    entityId: id,
    description: `Bootcamp "${updatedBootcamp.title}" ${isPublished ? 'published' : 'unpublished'} by Admin ${actorId}`,
    metadata: { isPublished }
  });

  return bootcampModel.toAdminBootcampResponse(updatedBootcamp);
}
