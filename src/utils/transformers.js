/**
 * Data Transformers
 * Handles sanitization and formatting of database entities for API responses.
 */
import { resolveThumbnailUrl, toStoredObjectSummary } from "./thumbnails.js";

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
// An allow-list: the certificate's own fields plus just enough about the
// enrollment to label it. Never the student's full user row (phone,
// address, date of birth…) or whole course/intake records (M08-13).
export function transformCertificate(certificate) {
  if (!certificate) return null;
  const { enrollment, ...own } = certificate;
  return {
    ...own,
    ...(enrollment
      ? {
          enrollment: {
            id: enrollment.id,
            userId: enrollment.userId,
            status: enrollment.status,
            user: enrollment.user ? { id: enrollment.user.id, firstName: enrollment.user.firstName, lastName: enrollment.user.lastName, email: enrollment.user.email } : undefined,
            course: enrollment.course ? { id: enrollment.course.id, title: enrollment.course.title, slug: enrollment.course.slug } : undefined,
            intake: enrollment.intake ? { id: enrollment.intake.id, code: enrollment.intake.code } : undefined,
          },
        }
      : {}),
  };
}

/**
 * Transform project for response.
 */
export function transformProject(project) {
  if (!project) return null;
  const { intake, ...own } = project;
  return {
    ...own,
    thumbnailUrl: resolveThumbnailUrl(project),
    thumbnailObject: toStoredObjectSummary(project.thumbnailObject, resolveThumbnailUrl(project)),
    // Only who submitted it — not their phone, address or date of birth
    // (M08-13).
    user: project.user
      ? { id: project.user.id, firstName: project.user.firstName, lastName: project.user.lastName, email: project.user.email }
      : undefined,
    // The client reads the course as project.course (M08-05).
    intake: intake ? { id: intake.id, code: intake.code, ...(intake.course ? { course: { id: intake.course.id, title: intake.course.title } } : {}) } : undefined,
    course: intake?.course ? { id: intake.course.id, title: intake.course.title } : undefined,
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
    thumbnailUrl: resolveThumbnailUrl(project),
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
      ? {
          firstName: project.user.firstName,
          lastName: project.user.lastName,
          // This project is itself approved + public, so a consented profile
          // is published — link the student's name to it.
          profileSlug: project.user.studentProfile?.publishConsentAt ? project.user.studentProfile.slug : null,
        }
      : undefined,
    course: project.intake?.course ? { title: project.intake.course.title } : undefined,
  };
}

export function transformPublicProjectList(projects) {
  return Array.isArray(projects) ? projects.map(transformPublicProject) : [];
}
