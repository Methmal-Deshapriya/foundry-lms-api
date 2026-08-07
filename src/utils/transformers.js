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
  return {
    ...project,
    user: project.user ? transformUser(project.user) : undefined,
  };
}

/**
 * Transform a list of projects.
 */
export function transformProjectList(projects) {
  if (!projects) return [];
  return projects.map(transformProject);
}
