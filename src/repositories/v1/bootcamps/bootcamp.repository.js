import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Bootcamp Repository - The "Librarian"
 * Handles all database operations for the Bootcamps module.
 */

/**
 * Fetch all bootcamps that are currently published.
 * @returns {Promise<Array>} List of published bootcamps.
 */
export async function findAllPublic() {
  return await prisma.bootcamp.findMany({
    where: { isPublished: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Fetch every bootcamp in the system (for Admin use).
 * @returns {Promise<Array>} List of all bootcamps.
 */
export async function findAllAdmin() {
  return await prisma.bootcamp.findMany({
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Find a specific bootcamp by its unique ID.
 * @param {string} id - The UUID of the bootcamp.
 * @returns {Promise<object|null>} The bootcamp object or null.
 */
export async function findById(id) {
  return await prisma.bootcamp.findUnique({
    where: { id },
  });
}

/**
 * Find a specific bootcamp by its URL-friendly slug.
 * @param {string} slug - The slug of the bootcamp.
 * @returns {Promise<object|null>} The bootcamp object or null.
 */
export async function findBySlug(slug) {
  return await prisma.bootcamp.findUnique({
    where: { slug },
  });
}

/**
 * Create a new bootcamp record.
 * @param {object} data - Title, slug, description, price.
 * @returns {Promise<object>} The newly created bootcamp.
 */
export async function create(data) {
  try {
    return await prisma.bootcamp.create({ data });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Update an existing bootcamp.
 * @param {string} id - The UUID of the bootcamp.
 * @param {object} data - The fields to update.
 * @returns {Promise<object>} The updated bootcamp.
 */
export async function update(id, data) {
  try {
    return await prisma.bootcamp.update({
      where: { id },
      data,
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Delete a bootcamp from the system.
 * @param {string} id - The UUID of the bootcamp to remove.
 * @returns {Promise<object>} The deleted bootcamp record.
 */
export async function remove(id) {
  try {
    return await prisma.bootcamp.delete({
      where: { id },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
