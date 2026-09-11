import * as projectRepo from "../../../repositories/v1/projects/project.repository.js";
import { createProjectSchema, updateProjectSchema, reviewProjectSchema } from "../../../constants/v1/projects/projects.schema.js";
import { ALL_PROJECT_STATUSES } from "../../../constants/v1/projects/projects.constants.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../../../utils/Errors.js";
import {
  transformProject,
  transformProjectList,
  transformPublicProject,
  transformPublicProjectList,
} from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { z } from "zod";

/**
 * Student Project Service
 */

/**
 * Service: Submit a new project (Student).
 */
export async function submitProjectService(requester, data) {
  // 1. Validation
  const validation = createProjectSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // Authorization, ownership, and enrollment eligibility are rechecked under
  // the same enrollment lock used by lifecycle commands.
  const project = await projectRepo.createForEnrollment(requester, {
    ...validation.data,
    userId: requester.id,
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

const projectAdminFiltersSchema = projectPageSchema.extend({
  q: z.string().trim().max(100).default(""),
  intakeId: z.string().uuid().optional(),
  status: z.enum(ALL_PROJECT_STATUSES).optional(),
  // Offset mode (a real "page N of M" + total) is used by the intake
  // workspace's Projects tab; the global admin page keeps cursor mode by
  // never sending this.
  offset: z.coerce.number().int().min(0).optional(),
});

function parsePage(schema, query) {
  const result = schema.safeParse(query);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

function toProjectStatusSummary(statusCounts) {
  const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const row of statusCounts) counts[row.status] = row._count;
  return { all: counts.PENDING + counts.APPROVED + counts.REJECTED, pending: counts.PENDING, approved: counts.APPROVED, rejected: counts.REJECTED };
}

export async function getMyProjectsService(userId, query = {}) {
  const page = await projectRepo.findByUserId(userId, parsePage(projectPageSchema, query));
  return { projects: transformProjectList(page.items), nextCursor: page.nextCursor };
}

/**
 * Service: Get all projects (Admin).
 */
export async function getAllProjectsAdminService(query = {}) {
  const filters = parsePage(projectAdminFiltersSchema, query);
  const page = await projectRepo.findAllAdmin(filters);
  const summary = toProjectStatusSummary(page.statusCounts);
  if (page.mode === "offset") {
    return {
      projects: transformProjectList(page.items),
      summary,
      pagination: { total: page.total, limit: filters.limit, offset: filters.offset, hasMore: filters.offset + page.items.length < page.total },
    };
  }
  return { projects: transformProjectList(page.items), summary, nextCursor: page.nextCursor };
}

/**
 * Service: Get public showcase.
 */
export async function getPublicShowcaseService(query = {}) {
  const page = await projectRepo.findPublicShowcase(parsePage(projectPageSchema, query));
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
