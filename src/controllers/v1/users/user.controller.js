import * as userService from "../../../services/v1/users/user.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * User Controller - The "Front Desk"
 * Handles administrative HTTP requests for user management.
 */

/**
 * Controller: Update the profile of the currently logged-in user.
 * PATCH /v1/users/profile
 */
export async function updateProfileController(req, res, next) {
  try {
    const userId = req.user.id;
    const updatedUser = await userService.updateUserProfileService(userId, req.body);
    return ApiResponse.send(res, updatedUser, "Profile updated successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get all users.
 */
export async function getAllUsersController(req, res, next) {
  try {
    const { role, limit = 10, offset = 0 } = req.query;
    const result = await userService.getAllUsersService(
      { role },
      Number(limit),
      Number(offset)
    );

    return ApiResponse.send(res, result, "User list fetched successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Promote a user to ADMIN.
 * PATCH /v1/users/:id/promote
 */
export async function promoteUserController(req, res, next) {
  try {
    const { id } = req.params;
    
    // We extract the actor's ID from the authenticated request
    const actorId = req.user.id;

    // We pass both the target ID and the actor ID to the service
    const user = await userService.promoteUserService(id, actorId);

    return ApiResponse.send(res, user, "User promoted to ADMIN successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Demote an ADMIN to STUDENT.
 * PATCH /v1/users/:id/demote
 */
export async function demoteUserController(req, res, next) {
  try {
    const { id } = req.params;
    
    // We extract the actor's ID from the authenticated request
    const actorId = req.user.id;

    // We pass both the target ID and the actor ID to the service
    const user = await userService.demoteUserService(id, actorId);

    return ApiResponse.send(res, user, "User demoted to STUDENT successfully");
  } catch (error) {
    next(error);
  }
}
