import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as userModel from "../../../models/v1/users/user.model.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import { ConflictError, NotFoundError, ForbiddenError } from "../../../utils/Errors.js";

/**
 * User Service - The "Brain"
 * Orchestrates administrative logic for user management.
 */

/**
 * Service: Get a list of all users.
 * 1. Fetch users from the repository.
 * 2. Sanitize the list using the model.
 * 
 * @returns {Promise<Array>} List of sanitized users.
 */
export async function getAllUsersService() {
  const users = await userRepo.findAllUsers();
  return userModel.toAdminUserListResponse(users);
}

/**
 * Service: Promote a user to the ADMIN role.
 * 1. Find the target user.
 * 2. Ensure they aren't already an admin.
 * 3. Update their role to ADMIN.
 * 
 * @param {string} targetId - The UUID of the user to promote.
 * @returns {Promise<object>} The updated, sanitized user.
 */
export async function promoteUserService(targetId) {
  // 1. Find the user first
  const user = await userRepo.findUserById(targetId);
  if (!user) {
    throw new NotFoundError("Target user not found.");
  }

  // 2. Safety Check: If already an Admin or Super Admin, promotion is invalid.
  if (user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN) {
    throw new ConflictError(`User is already an ${user.role}.`);
  }

  // 3. Update the role
  const updatedUser = await userRepo.updateUserRole(targetId, ROLES.ADMIN);

  // 4. Return sanitized response
  return userModel.toAdminUserResponse(updatedUser);
}

/**
 * Service: Demote an ADMIN back to STUDENT.
 * 1. Find the target user.
 * 2. Ensure they aren't a SUPER_ADMIN (Forbidden).
 * 3. Ensure they aren't already a STUDENT.
 * 4. Update their role to STUDENT.
 * 
 * @param {string} targetId - The UUID of the user to demote.
 * @returns {Promise<object>} The updated, sanitized user.
 */
export async function demoteUserService(targetId) {
  // 1. Find the user first
  const user = await userRepo.findUserById(targetId);
  if (!user) {
    throw new NotFoundError("Target user not found.");
  }

  // 2. Safety Check: Never allow demoting a Super Admin.
  if (user.role === ROLES.SUPER_ADMIN) {
    throw new ForbiddenError("Super Admins cannot be demoted via this endpoint.");
  }

  // 3. Safety Check: If already a student, demotion is redundant.
  if (user.role === ROLES.STUDENT) {
    throw new ConflictError("User is already a Student.");
  }

  // 4. Update the role
  const updatedUser = await userRepo.updateUserRole(targetId, ROLES.STUDENT);

  // 5. Return sanitized response
  return userModel.toAdminUserResponse(updatedUser);
}
