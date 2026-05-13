/**
 * Bootcamp Model - The "Course Mask"
 * Defines different views of bootcamp data for public users and admins.
 */

/**
 * Transform a raw bootcamp object into a safe, public marketplace response.
 * @param {object} bootcamp - The raw bootcamp object from Prisma.
 * @returns {object|null} The public-safe bootcamp object.
 */
export function toPublicBootcampResponse(bootcamp) {
  if (!bootcamp) return null;

  return {
    id: bootcamp.id,
    title: bootcamp.title,
    slug: bootcamp.slug,
    description: bootcamp.description,
    price: bootcamp.price,
    certificateEnabled: bootcamp.certificateEnabled,
    skills: bootcamp.skills,
    createdAt: bootcamp.createdAt,
  };
}

/**
 * Transform a raw bootcamp object into a full administrative response.
 * @param {object} bootcamp - The raw bootcamp object from Prisma.
 * @returns {object|null} The full administrative bootcamp object.
 */
export function toAdminBootcampResponse(bootcamp) {
  if (!bootcamp) return null;

  return {
    id: bootcamp.id,
    title: bootcamp.title,
    slug: bootcamp.slug,
    description: bootcamp.description,
    price: bootcamp.price,
    isPublished: bootcamp.isPublished,
    certificateEnabled: bootcamp.certificateEnabled,
    skills: bootcamp.skills,
    createdAt: bootcamp.createdAt,
    updatedAt: bootcamp.updatedAt,
  };
}

/**
 * Transform an array of bootcamps into public marketplace responses.
 * @param {Array} bootcamps - Array of raw bootcamp objects.
 */
export function toPublicBootcampListResponse(bootcamps) {
  if (!bootcamps || !Array.isArray(bootcamps)) return [];
  return bootcamps.map((b) => toPublicBootcampResponse(b));
}

/**
 * Transform an array of bootcamps into administrative responses.
 * @param {Array} bootcamps - Array of raw bootcamp objects.
 */
export function toAdminBootcampListResponse(bootcamps) {
  if (!bootcamps || !Array.isArray(bootcamps)) return [];
  return bootcamps.map((b) => toAdminBootcampResponse(b));
}
