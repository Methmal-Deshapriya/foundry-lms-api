/**
 * Auth Model - The "Mask"
 * Defines the public shape of user data for the API.
 */

/**
 * Transform a raw database user object into a safe, API-ready response.
 * This ensures sensitive fields (like password) are never exposed.
 * 
 * @param {object} user - The raw user object from Prisma.
 * @returns {object|null} The clean user object or null.
 */
export function toUserResponse(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    // We can add or rename fields here if the frontend needs a different shape
  };
}
