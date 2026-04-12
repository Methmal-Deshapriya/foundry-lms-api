/**
 * User Model - The "Admin Filter"
 * Defines the shape of user data when viewed by administrators.
 */

/**
 * Transform a raw database user object into a safe, admin-ready response.
 * @param {object} user - The raw user object from Prisma.
 * @returns {object|null} The sanitized user object or null.
 */
export function toAdminUserResponse(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Transform an array of raw user objects into safe, admin-ready responses.
 * @param {Array} users - Array of raw user objects.
 * @returns {Array} Array of sanitized user objects.
 */
export function toAdminUserListResponse(users) {
  if (!users || !Array.isArray(users)) return [];
  
  // .map() is a pro JS way to apply a function to every item in an array
  return users.map((user) => toAdminUserResponse(user));
}
