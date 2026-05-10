/**
 * Data Transformers
 * Handles sanitization and formatting of database entities for API responses.
 */

/**
 * Sanitize user object by removing sensitive fields.
 */
export function transformUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

/**
 * Transform enrollment for response.
 */
export function transformEnrollment(enrollment) {
  if (!enrollment) return null;
  return {
    ...enrollment,
    user: transformUser(enrollment.user),
  };
}

/**
 * Transform certificate for response.
 */
export function transformCertificate(certificate) {
  if (!certificate) return null;
  return certificate;
}

/**
 * Transform project for response.
 */
export function transformProject(project) {
  if (!project) return null;
  return project;
}
