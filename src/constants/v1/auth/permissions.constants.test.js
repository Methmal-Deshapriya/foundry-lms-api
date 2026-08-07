import { describe, expect, it } from "vitest";
import { ROLES } from "../users/users.constants.js";
import { hasPermission, PERMISSIONS } from "./permissions.constants.js";

describe("central authorization policy", () => {
  it("allows admins to edit catalog drafts but not publish them", () => {
    expect(hasPermission(ROLES.ADMIN, PERMISSIONS.CATALOG_EDIT_DRAFTS)).toBe(true);
    expect(hasPermission(ROLES.ADMIN, PERMISSIONS.CATALOG_PUBLISH)).toBe(false);
  });

  it("reserves catalog publication and role changes for super admins", () => {
    expect(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.CATALOG_PUBLISH)).toBe(true);
    expect(hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.USERS_MANAGE_ROLES)).toBe(true);
  });

  it("reserves permanent catalog deletion for super admins", () => {
    expect(
      hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.CATALOG_DELETE_PERMANENTLY),
    ).toBe(true);
    expect(
      hasPermission(ROLES.ADMIN, PERMISSIONS.CATALOG_DELETE_PERMANENTLY),
    ).toBe(false);
    expect(
      hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.SESSIONS_DELETE_PERMANENTLY),
    ).toBe(true);
    expect(
      hasPermission(ROLES.ADMIN, PERMISSIONS.SESSIONS_DELETE_PERMANENTLY),
    ).toBe(false);
  });

  it("only grants students the free-course self-enrollment capability", () => {
    expect(hasPermission(ROLES.STUDENT, PERMISSIONS.COURSES_SELF_ENROLL)).toBe(true);
    expect(hasPermission(ROLES.STUDENT, PERMISSIONS.CATALOG_VIEW_ADMIN)).toBe(false);
  });

  it("allows admins and super admins to manage learning delivery", () => {
    const deliveryPermissions = [
      PERMISSIONS.SESSIONS_VIEW_LIBRARY,
      PERMISSIONS.SESSIONS_MANAGE_LIBRARY,
      PERMISSIONS.COURSE_CURRICULUM_MANAGE,
      PERMISSIONS.BATCHES_MANAGE,
      PERMISSIONS.BATCH_SESSIONS_RELEASE,
    ];

    for (const permission of deliveryPermissions) {
      expect(hasPermission(ROLES.ADMIN, permission)).toBe(true);
      expect(hasPermission(ROLES.SUPER_ADMIN, permission)).toBe(true);
      expect(hasPermission(ROLES.STUDENT, permission)).toBe(false);
    }
  });
});
