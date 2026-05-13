import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as userModel from "../../../models/v1/users/user.model.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import { updateProfileSchema } from "../../../constants/v1/auth/auth.schema.js";
import { transformUser } from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from "../../../utils/Errors.js";

/**
 * User Service - The "Brain"
 * Orchestrates administrative logic for user management.
 */

/**
 * Service: Update user profile.
 * @param {string} userId - ID of the user being updated.
 * @param {object} data - Profile fields.
 */
export async function updateUserProfileService(userId, data) {
  // 1. Validation
  const validation = updateProfileSchema.safeParse(data);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Existence Check
  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw new NotFoundError("User not found.");
  }

  // 3. Update
  const updatedUser = await userRepo.updateUser(userId, validation.data);

  return transformUser(updatedUser);
}

/**
 * Service: Get a paginated list of users with optional role filtering.
 */
export async function getAllUsersService(filters = {}, limit = 10, offset = 0) {
  const sanitizedFilters = {};

  if (filters.role && Object.values(ROLES).includes(filters.role)) {
    sanitizedFilters.role = filters.role;
  }

  const { total, users } = await userRepo.findAndCountUsers(
    sanitizedFilters,
    limit,
    offset
  );
  const sanitizedUsers = userModel.toAdminUserListResponse(users);

  return {
    users: sanitizedUsers,
    pagination: {
      total,
      limit: Number(limit),
      offset: Number(offset),
      hasMore: Number(offset) + sanitizedUsers.length < total,
    },
  };
}

/**
 * Service: Promote a user to the ADMIN role.
 * @param {string} targetId - The user being promoted.
 * @param {string} actorId - The Super Admin performing the action.
 */
export async function promoteUserService(targetId, actorId) {
  // 1. Find the target user
  const user = await userRepo.findUserById(targetId);
  if (!user) {
    throw new NotFoundError("Target user not found.");
  }

  // 2. Safety Check
  if (user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN) {
    throw new ConflictError(`User is already an ${user.role}.`);
  }

  // 3. Update the role in DB
  const updatedUser = await userRepo.updateUserRole(targetId, ROLES.ADMIN);

  // 4. --- Audit Log (Fire and Forget) ---
  // Note: We do NOT 'await' this.
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.USER_PROMOTED,
    entityType: ENTITY_TYPES.USER,
    entityId: targetId,
    description: `User ${user.email} promoted to ADMIN by Admin ${actorId}`,
    metadata: { oldRole: user.role, newRole: ROLES.ADMIN }
  });

  return userModel.toAdminUserResponse(updatedUser);
}

/**
 * Service: Demote an ADMIN back to STUDENT.
 * @param {string} targetId - The user being demoted.
 * @param {string} actorId - The Super Admin performing the action.
 */
export async function demoteUserService(targetId, actorId) {
  // 1. Find the target user
  const user = await userRepo.findUserById(targetId);
  if (!user) {
    throw new NotFoundError("Target user not found.");
  }

  // 2. Safety Checks
  if (user.role === ROLES.SUPER_ADMIN) {
    throw new ForbiddenError("Super Admins cannot be demoted via this endpoint.");
  }

  if (user.role === ROLES.STUDENT) {
    throw new ConflictError("User is already a Student.");
  }

  // 3. Update the role in DB
  const updatedUser = await userRepo.updateUserRole(targetId, ROLES.STUDENT);

  // 4. --- Audit Log (Fire and Forget) ---
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.USER_DEMOTED,
    entityType: ENTITY_TYPES.USER,
    entityId: targetId,
    description: `User ${user.email} demoted to STUDENT by Admin ${actorId}`,
    metadata: { oldRole: user.role, newRole: ROLES.STUDENT }
  });

  return userModel.toAdminUserResponse(updatedUser);
}
