import * as userService from "../../../services/v1/users/user.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * User Controller - The "Front Desk"
 * Handles administrative HTTP requests for user management.
 */

/**
 * Controller: Get all users.
 * GET /v1/users
 */
export async function getAllUsersController(req, res, next) {
  try {
    // 1. Call the service to fetch and sanitize the user list
    const users = await userService.getAllUsersService();

    // 2. Return success response
    return ApiResponse.send(res, users, "User list fetched successfully");
  } catch (error) {
    // Pass errors to the Global Error Handler
    next(error);
  }
}

/**
 * Controller: Promote a user to ADMIN.
 * PATCH /v1/users/:id/promote
 */
export async function promoteUserController(req, res, next) {
  try {
    // 1. Extract the target user ID from the URL parameters
    const { id } = req.params;

    // 2. Call the service to perform the promotion logic
    const user = await userService.promoteUserService(id);

    // 3. Return success response
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
    // 1. Extract the target user ID from the URL parameters
    const { id } = req.params;

    // 2. Call the service to perform the demotion logic
    const user = await userService.demoteUserService(id);

    // 3. Return success response
    return ApiResponse.send(res, user, "User demoted to STUDENT successfully");
  } catch (error) {
    next(error);
  }
}
