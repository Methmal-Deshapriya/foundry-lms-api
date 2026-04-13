/**
 * Audit Module Constants
 * Defines the standard vocabulary for all logged actions and entities.
 */

export const AUDIT_ACTIONS = {
  // User Management
  USER_PROMOTED: "USER_PROMOTED",
  USER_DEMOTED: "USER_DEMOTED",
  
  // Bootcamp Management
  BOOTCAMP_CREATED: "BOOTCAMP_CREATED",
  BOOTCAMP_UPDATED: "BOOTCAMP_UPDATED",
  BOOTCAMP_DELETED: "BOOTCAMP_DELETED",
  BOOTCAMP_PUBLISHED: "BOOTCAMP_PUBLISHED",
  BOOTCAMP_UNPUBLISHED: "BOOTCAMP_UNPUBLISHED",
  
  // Enrollment Management
  STUDENT_ENROLLED: "STUDENT_ENROLLED",
};

export const ENTITY_TYPES = {
  USER: "USER",
  BOOTCAMP: "BOOTCAMP",
  ENROLLMENT: "ENROLLMENT",
};
