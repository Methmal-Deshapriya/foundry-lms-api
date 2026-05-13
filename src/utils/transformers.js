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

/**
 * Transform session for response.
 */
export function transformSession(session) {
  if (!session) return null;
  return session;
}

/**
 * Transform a list of sessions.
 */
export function transformSessionList(sessions) {
  if (!sessions) return [];
  return sessions.map(transformSession);
}
