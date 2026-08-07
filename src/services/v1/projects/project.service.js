import * as projectRepo from "../../../repositories/v1/projects/project.repository.js";
import { createProjectSchema, updateProjectSchema, reviewProjectSchema } from "../../../constants/v1/projects/projects.schema.js";
import { assertProjectOwnership } from "../../../utils/accessHelpers.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../../../utils/Errors.js";
import { transformProject, transformProjectList } from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { requireEnrollmentAccessService } from "../learning/classroom.service.js";

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
  // 1. Ownership & Status Check
  const project = await assertProjectOwnership(userId, projectId);
  
  if (project.status !== "PENDING") {
    throw new ForbiddenError("Projects can only be edited while their status is PENDING.");
  }

  // 2. Validation
  const validation = updateProjectSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 3. Action
  const updated = await projectRepo.update(projectId, validation.data);

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

  // 2. Existence Check
  const project = await projectRepo.findById(projectId);
  if (!project) {
    throw new NotFoundError("Project not found.");
  }

  // 3. Action
  const updated = await projectRepo.update(projectId, {
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
    description: `Project "${project.title}" reviewed (Status: ${validation.data.status}) by Admin ${actorId}`,
    metadata: { status: validation.data.status }
  });

  return transformProject(updated);
}

/**
 * Service: Get my projects (Student).
 */
export async function getMyProjectsService(userId) {
  const projects = await projectRepo.findByUserId(userId);
  return transformProjectList(projects);
}

/**
 * Service: Get all projects (Admin).
 */
export async function getAllProjectsAdminService() {
  const projects = await projectRepo.findAllAdmin();
  return transformProjectList(projects);
}

/**
 * Service: Get public showcase.
 */
export async function getPublicShowcaseService() {
  const projects = await projectRepo.findPublicShowcase();
  return transformProjectList(projects);
}

/**
 * Service: Get single project details.
 */
export async function getProjectDetailsService(projectId, userId, isAdmin = false) {
  const project = await projectRepo.findById(projectId);
  if (!project) {
    throw new NotFoundError("Project not found.");
  }

  // Privacy Rule: Students can see their own projects OR any approved public project.
  // Admins can see everything.
  const isOwner = project.userId === userId;
  const isPublicApproved = project.isPublic && project.status === "APPROVED";

  if (!isAdmin && !isOwner && !isPublicApproved) {
    throw new ForbiddenError("Access denied.");
  }

  return transformProject(project);
}
