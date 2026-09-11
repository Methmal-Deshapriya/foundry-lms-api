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
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Transform a raw database user, plus its pre-fetched activity sections,
 * into the full admin user-detail response. Every section is shaped
 * { total, items } — see userActivity.repository.js for how each is bounded.
 * @param {object} user - The raw user object from Prisma.
 * @param {object} sections - The eight activity sections for this user.
 * @returns {object|null} The sanitized user-detail object or null.
 */
export function toAdminUserDetailResponse(user, sections) {
  if (!user) return null;

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    phone: user.phone,
    address: user.address,
    district: user.district,
    dateOfBirth: user.dateOfBirth,
    alStream: user.alStream,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    enrollments: sections.enrollments,
    managedEnrollments: sections.managedEnrollments,
    paymentsRecorded: sections.paymentsRecorded,
    paymentsMade: sections.paymentsMade,
    certificates: sections.certificates,
    studentProjects: sections.studentProjects,
    enrollmentRequests: sections.enrollmentRequests,
    auditActions: sections.auditActions,
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
