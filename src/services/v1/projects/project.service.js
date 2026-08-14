import * as projectRepo from "../../../repositories/v1/projects/project.repository.js";
import { createProjectSchema, updateProjectSchema, reviewProjectSchema } from "../../../constants/v1/projects/projects.schema.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../../../utils/Errors.js";
import {
  transformProject,
  transformProjectList,
  transformPublicProject,
  transformPublicProjectList,
} from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { requireEnrollmentAccessService } from "../learning/classroom.service.js";
import { z } from "zod";

/**
 * Student Project Service
 */

/**
 * Service: Submit a new project (Student).
 */
export async function submitProjectService(userId, data) {
  // 1. Validation
  const validation = createProjectSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { enrollmentId, courseId } = validation.data;

  // 2. Access/Ownership Check
  // Verify enrollment belongs to the user and matches the course.
  const { enrollment } = await requireEnrollmentAccessService(
    enrollmentId,
    { id: userId, role: "STUDENT" },
    { adminsAllowed: false },
  );
  if (enrollment.courseId !== courseId) {
    throw new ForbiddenError("Invalid enrollment for this project submission.");
  }

  // 3. Action
  const project = await projectRepo.create({
    ...validation.data,
    userId,
    status: "PENDING",
  });

  return transformProject(project);
}

/**
 * Service: Update a project (Student).
 * Allowed only while status is PENDING.
 */
export async function updateProjectService(projectId, userId, data) {
  // Validation happens before the short transaction; ownership and status are
  // rechecked under the same project lock used by administrative review.
  const validation = updateProjectSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const updated = await projectRepo.updatePendingOwned(
    projectId,
    userId,
    validation.data,
  );

  return transformProject(updated);
}

/**
 * Service: Review a project (Admin).
 */
export async function reviewProjectService(projectId, data, actorId) {
  // 1. Validation
  const validation = reviewProjectSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // Review and student edits serialize on the same project lock. The admin
  // therefore always reviews the content version that is actually published.
  const { project: updated, previous } = await projectRepo.review(projectId, {
    ...validation.data,
    reviewedBy: actorId,
    reviewedAt: new Date(),
  });

  // 4. Audit
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.PROJECT_REVIEWED,
    entityType: ENTITY_TYPES.STUDENT_PROJECT,
    entityId: projectId,
    description: `Project "${previous.title}" reviewed (Status: ${validation.data.status}) by Admin ${actorId}`,
    metadata: { status: validation.data.status }
  });

  return transformProject(updated);
}

/**
 * Service: Get my projects (Student).
 */
const projectPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});

function parseProjectPage(query) {
  const result = projectPageSchema.safeParse(query);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

export async function getMyProjectsService(userId, query = {}) {
  const page = await projectRepo.findByUserId(userId, parseProjectPage(query));
  return { projects: transformProjectList(page.items), nextCursor: page.nextCursor };
}

/**
 * Service: Get all projects (Admin).
 */
export async function getAllProjectsAdminService(query = {}) {
  const page = await projectRepo.findAllAdmin(parseProjectPage(query));
  return { projects: transformProjectList(page.items), nextCursor: page.nextCursor };
}

/**
 * Service: Get public showcase.
 */
export async function getPublicShowcaseService(query = {}) {
  const page = await projectRepo.findPublicShowcase(parseProjectPage(query));
  return {
    projects: transformPublicProjectList(page.items),
    nextCursor: page.nextCursor,
  };
}

export async function getPublicProjectDetailsService(projectId) {
  const project = await projectRepo.findPublicById(projectId);
  if (!project) throw new NotFoundError("Public project not found.");
  return transformPublicProject(project);
}

/**
 * Service: Get single project details.
 */
export async function getProjectDetailsService(projectId, userId, isAdmin = false) {
  const project = await projectRepo.findById(projectId);
  if (!project) {
    throw new NotFoundError("Project not found.");
  }

  // Protected detail is owner/admin only. Public reads use the separately
  // projected getPublicProjectDetailsService response.
  const isOwner = project.userId === userId;
  if (!isAdmin && !isOwner) {
    throw new ForbiddenError("Access denied.");
  }

  return transformProject(project);
}
