import * as projectService from "../../../services/v1/projects/project.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";

/**
 * Student Project Controller
 */

export async function submitProject(req, res, next) {
  try {
    const userId = req.user.id;
    const project = await projectService.submitProjectService(userId, req.body);
    return ApiResponse.send(res, project, "Project submitted successfully", 201);
  } catch (error) {
    next(error);
  }
}

export async function updateProject(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const project = await projectService.updateProjectService(id, userId, req.body);
    return ApiResponse.send(res, project, "Project updated successfully");
  } catch (error) {
    next(error);
  }
}

export async function reviewProject(req, res, next) {
  try {
    const { id } = req.params;
    const actorId = req.user.id;
    const project = await projectService.reviewProjectService(id, req.body, actorId);
    return ApiResponse.send(res, project, "Project review completed");
  } catch (error) {
    next(error);
  }
}

export async function getMyProjects(req, res, next) {
  try {
    const userId = req.user.id;
    const projects = await projectService.getMyProjectsService(userId, req.query);
    return ApiResponse.send(res, projects, "Your projects fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getAllProjectsAdmin(req, res, next) {
  try {
    const projects = await projectService.getAllProjectsAdminService(req.query);
    return ApiResponse.send(res, projects, "All projects fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getPublicShowcase(req, res, next) {
  try {
    const projects = await projectService.getPublicShowcaseService(req.query);
    return ApiResponse.send(res, projects, "Public showcase fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getPublicProjectDetails(req, res, next) {
  try {
    const project = await projectService.getPublicProjectDetailsService(
      req.params.id,
    );
    return ApiResponse.send(res, project, "Public project fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getProjectDetails(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const isAdmin = req.user ? [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role) : false;

    const project = await projectService.getProjectDetailsService(id, userId, isAdmin);
    return ApiResponse.send(res, project, "Project details fetched successfully");
  } catch (error) {
    next(error);
  }
}
