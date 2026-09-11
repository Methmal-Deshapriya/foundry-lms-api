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

/** Public-project responses are allowlists, never sanitized copies of an
 * owner/admin record. Keep this shape intentionally small. */
export function transformPublicProject(project) {
  if (!project) return null;
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    thumbnailUrl: project.thumbnailUrl,
    projectUrl: project.projectUrl,
    githubUrl: project.githubUrl,
    demoUrl: project.demoUrl,
    technologies: project.technologies,
    status: project.status,
    isPublic: project.isPublic,
    displayOrder: project.displayOrder,
    likeCount: project.likeCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    user: project.user
      ? { firstName: project.user.firstName, lastName: project.user.lastName }
      : undefined,
    course: project.intake?.course ? { title: project.intake.course.title } : undefined,
  };
}

export function transformPublicProjectList(projects) {
  return Array.isArray(projects) ? projects.map(transformPublicProject) : [];
}
