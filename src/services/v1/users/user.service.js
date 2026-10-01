import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as userActivityRepo from "../../../repositories/v1/users/userActivity.repository.js";
import * as userModel from "../../../models/v1/users/user.model.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import {
  userIdSchema,
  userListQuerySchema,
} from "../../../constants/v1/users/user.schema.js";
import { updateProfileSchema } from "../../../constants/v1/auth/auth.schema.js";
import { transformUser } from "../../../utils/transformers.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from "../../../utils/Errors.js";
import { PERMISSIONS, hasPermission } from "../../../constants/v1/auth/permissions.constants.js";

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
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  // 2. Existence Check
  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw new NotFoundError("User not found.");
  }

  // 3. Update
  const updateData = {
    ...validation.data,
    ...(validation.data.dateOfBirth
      ? { dateOfBirth: new Date(`${validation.data.dateOfBirth}T00:00:00.000Z`) }
      : {}),
  };
  const updatedUser = await userRepo.updateUser(userId, updateData);

  return transformUser(updatedUser);
}

/**
 * Service: Get a paginated list of users with optional role filtering.
 */
export async function getAllUsersService(query = {}) {
  const validation = userListQuerySchema.safeParse(query);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue.message, issue.path.join(".") || null);
  }
  const { role, limit, offset } = validation.data;
  const sanitizedFilters = role ? { role } : {};

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
 * Service: Get one user's full profile plus a bounded, recent view of their
 * activity across the system, for the admin user detail view.
 * @param {string} id - The UUID of the user to fetch.
 */
export async function getUserDetailService(id, viewer = null) {
  const parsedId = userIdSchema.safeParse(id);
  if (!parsedId.success) {
    throw new ValidationError(parsedId.error.issues[0].message, "id");
  }

  const user = await userRepo.findUserById(id);
  if (!user) {
    throw new NotFoundError("User not found.");
  }

  const [
    enrollments,
    managedEnrollments,
    paymentsRecorded,
    paymentsMade,
    certificates,
    studentProjects,
    enrollmentRequests,
    auditActions,
  ] = await Promise.all([
    userActivityRepo.findEnrollmentsForUser(id),
    userActivityRepo.findManagedEnrollmentsForUser(id),
    userActivityRepo.findPaymentsRecordedByUser(id),
    userActivityRepo.findPaymentsForUser(id),
    userActivityRepo.findCertificatesForUser(id),
    userActivityRepo.findStudentProjectsForUser(id),
    userActivityRepo.findEnrollmentRequestsForUser(id),
    // The audit trail is super-admin only (AUDIT_VIEW): a super admin's
    // rows describe partner payouts, share splits and refunds, so an admin
    // viewing their profile must not see them (code review M10-02).
    viewer && hasPermission(viewer.role, PERMISSIONS.AUDIT_VIEW) ? userActivityRepo.findAuditLogsForActor(id) : null,
  ]);

  return userModel.toAdminUserDetailResponse(user, {
    enrollments,
    managedEnrollments,
    paymentsRecorded,
    paymentsMade,
    certificates,
    studentProjects,
    enrollmentRequests,
    auditActions,
  });
}

/**
 * Service: Promote a user to the ADMIN role.
 * @param {string} targetId - The user being promoted.
 * @param {string} actorId - The Super Admin performing the action.
 */
export async function promoteUserService(targetId, actorId) {
  const parsedId = userIdSchema.safeParse(targetId);
  if (!parsedId.success) {
    throw new ValidationError(parsedId.error.issues[0].message, "id");
  }
  // 1. Find the target user
  const user = await userRepo.findUserById(targetId);
  if (!user) {
    throw new NotFoundError("Target user not found.");
  }

  // 2. Safety Check
  if (user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN) {
    throw new ConflictError(`User is already an ${user.role}.`);
  }

  // 3. Change the role only if it is still what we checked, with the audit
  // row in the same transaction (code review M10-06).
  const updatedUser = await userRepo.changeRoleAudited(targetId, user.role, ROLES.ADMIN, {
    actorUserId: actorId,
    action: AUDIT_ACTIONS.USER_PROMOTED,
    entityType: ENTITY_TYPES.USER,
    entityId: targetId,
    description: `User ${user.email} promoted to ADMIN by Admin ${actorId}`,
    metadata: { oldRole: user.role, newRole: ROLES.ADMIN },
  });
  if (!updatedUser) throw new ConflictError("This user's role just changed. Refresh and try again.", "STALE_USER_ROLE");

  return userModel.toAdminUserResponse(updatedUser);
}

/**
 * Service: Demote an ADMIN back to STUDENT.
 * @param {string} targetId - The user being demoted.
 * @param {string} actorId - The Super Admin performing the action.
 */
export async function demoteUserService(targetId, actorId) {
  const parsedId = userIdSchema.safeParse(targetId);
  if (!parsedId.success) {
    throw new ValidationError(parsedId.error.issues[0].message, "id");
  }
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

  // 3. Change the role only if it is still what we checked, with the audit
  // row in the same transaction (code review M10-06).
  const updatedUser = await userRepo.changeRoleAudited(targetId, user.role, ROLES.STUDENT, {
    actorUserId: actorId,
    action: AUDIT_ACTIONS.USER_DEMOTED,
    entityType: ENTITY_TYPES.USER,
    entityId: targetId,
    description: `User ${user.email} demoted to STUDENT by Admin ${actorId}`,
    metadata: { oldRole: user.role, newRole: ROLES.STUDENT },
  });
  if (!updatedUser) throw new ConflictError("This user's role just changed. Refresh and try again.", "STALE_USER_ROLE");

  return userModel.toAdminUserResponse(updatedUser);
}

// ============================================================ Account access
// Super admins can end someone's sessions, or suspend the account, without
// touching the database (code review M10-05). Each is audited in the same
// transaction as the change.

async function findAccessTarget(targetId, actorId) {
  const parsedId = userIdSchema.safeParse(targetId);
  if (!parsedId.success) throw new ValidationError(parsedId.error.issues[0].message, "id");
  if (targetId === actorId) throw new ConflictError("You can't do this to your own account.", "SELF_ACCESS_CHANGE");
  const user = await userRepo.findUserById(targetId);
  if (!user) throw new NotFoundError("Target user not found.");
  return user;
}

/** End every session the user has (stolen laptop, shared device). */
export async function revokeUserSessionsService(targetId, actorId) {
  const user = await findAccessTarget(targetId, actorId);
  const updated = await userRepo.updateAccessAudited(targetId, { revokeOnly: true }, {
    actorUserId: actorId,
    action: AUDIT_ACTIONS.USER_SESSIONS_REVOKED,
    entityType: ENTITY_TYPES.USER,
    entityId: targetId,
    description: `Signed ${user.email} out of every session.`,
  });
  return userModel.toAdminUserResponse(updated);
}

/** Suspend: no sign-in and no session until reactivated. */
export async function suspendUserService(targetId, actorId) {
  const user = await findAccessTarget(targetId, actorId);
  if (user.disabledAt) throw new ConflictError("This account is already suspended.", "USER_ALREADY_SUSPENDED");
  // Never leave the academy without a super admin who can sign in.
  if (user.role === ROLES.SUPER_ADMIN && (await userRepo.countActiveSuperAdmins()) <= 1) {
    throw new ConflictError("This is the last super admin who can sign in, so it can't be suspended.", "LAST_SUPER_ADMIN");
  }
  const updated = await userRepo.updateAccessAudited(targetId, { disabledAt: new Date() }, {
    actorUserId: actorId,
    action: AUDIT_ACTIONS.USER_SUSPENDED,
    entityType: ENTITY_TYPES.USER,
    entityId: targetId,
    description: `Suspended ${user.email} (${user.role}).`,
    metadata: { role: user.role },
  });
  return userModel.toAdminUserResponse(updated);
}

export async function reactivateUserService(targetId, actorId) {
  const user = await findAccessTarget(targetId, actorId);
  if (!user.disabledAt) throw new ConflictError("This account isn't suspended.", "USER_NOT_SUSPENDED");
  const updated = await userRepo.updateAccessAudited(targetId, { disabledAt: null }, {
    actorUserId: actorId,
    action: AUDIT_ACTIONS.USER_REACTIVATED,
    entityType: ENTITY_TYPES.USER,
    entityId: targetId,
    description: `Reactivated ${user.email} (${user.role}).`,
    metadata: { role: user.role },
  });
  return userModel.toAdminUserResponse(updated);
}
