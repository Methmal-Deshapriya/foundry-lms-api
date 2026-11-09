import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/users/user.repository.js", () => ({
  findUserById: vi.fn(),
  changeRoleAudited: vi.fn(),
  updateAccessAudited: vi.fn(),
  countActiveSuperAdmins: vi.fn(),
}));
vi.mock("../../../repositories/v1/users/userActivity.repository.js", () => ({
  findEnrollmentsForUser: vi.fn(),
  findManagedEnrollmentsForUser: vi.fn(),
  findPaymentsRecordedByUser: vi.fn(),
  findPaymentsForUser: vi.fn(),
  findCertificatesForUser: vi.fn(),
  findStudentProjectsForUser: vi.fn(),
  findEnrollmentRequestsForUser: vi.fn(),
  findAuditLogsForActor: vi.fn(),
}));

import * as userRepository from "../../../repositories/v1/users/user.repository.js";
import * as userActivityRepository from "../../../repositories/v1/users/userActivity.repository.js";
import {
  demoteUserService,
  getUserDetailService,
  promoteUserService,
  reactivateUserService,
  revokeUserSessionsService,
  suspendUserService,
} from "./user.service.js";

const superAdmin = { id: "90000000-0000-4000-8000-000000000009", role: "SUPER_ADMIN" };
const admin = { id: "90000000-0000-4000-8000-000000000008", role: "ADMIN" };

beforeEach(() => vi.clearAllMocks());

const userId = "90000000-0000-4000-8000-000000000001";

function userFixture(overrides = {}) {
  return {
    id: userId,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    role: "STUDENT",
    phone: "0710000000",
    address: "1 Analytical Engine Rd",
    district: "Colombo",
    dateOfBirth: new Date("2000-01-01"),
    alStream: "Mathematics",
    emailVerified: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...overrides,
  };
}

const emptySection = { total: 0, items: [] };

function mockAllSections() {
  userActivityRepository.findEnrollmentsForUser.mockResolvedValue(emptySection);
  userActivityRepository.findManagedEnrollmentsForUser.mockResolvedValue(emptySection);
  userActivityRepository.findPaymentsRecordedByUser.mockResolvedValue(emptySection);
  userActivityRepository.findPaymentsForUser.mockResolvedValue(emptySection);
  userActivityRepository.findCertificatesForUser.mockResolvedValue(emptySection);
  userActivityRepository.findStudentProjectsForUser.mockResolvedValue(emptySection);
  userActivityRepository.findEnrollmentRequestsForUser.mockResolvedValue(emptySection);
  userActivityRepository.findAuditLogsForActor.mockResolvedValue(emptySection);
}

describe("getUserDetailService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a non-UUID id before touching the database", async () => {
    await expect(getUserDetailService("not-a-uuid")).rejects.toThrow(ValidationError);
    expect(userRepository.findUserById).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the user does not exist", async () => {
    userRepository.findUserById.mockResolvedValue(null);

    await expect(getUserDetailService(userId)).rejects.toThrow(NotFoundError);
  });

  it("assembles the full profile plus every bounded activity section", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture());
    mockAllSections();
    const enrollments = { total: 3, items: [{ id: "e1" }] };
    userActivityRepository.findEnrollmentsForUser.mockResolvedValue(enrollments);

    const result = await getUserDetailService(userId, superAdmin);

    expect(userActivityRepository.findEnrollmentsForUser).toHaveBeenCalledWith(userId);
    expect(userActivityRepository.findManagedEnrollmentsForUser).toHaveBeenCalledWith(userId);
    expect(userActivityRepository.findPaymentsRecordedByUser).toHaveBeenCalledWith(userId);
    expect(userActivityRepository.findPaymentsForUser).toHaveBeenCalledWith(userId);
    expect(userActivityRepository.findCertificatesForUser).toHaveBeenCalledWith(userId);
    expect(userActivityRepository.findStudentProjectsForUser).toHaveBeenCalledWith(userId);
    expect(userActivityRepository.findEnrollmentRequestsForUser).toHaveBeenCalledWith(userId);
    expect(userActivityRepository.findAuditLogsForActor).toHaveBeenCalledWith(userId);

    expect(result).toMatchObject({
      id: userId,
      email: "ada@example.com",
      phone: "0710000000",
      address: "1 Analytical Engine Rd",
      district: "Colombo",
      alStream: "Mathematics",
      emailVerified: false,
      enrollments,
      managedEnrollments: emptySection,
      paymentsRecorded: emptySection,
      paymentsMade: emptySection,
      certificates: emptySection,
      studentProjects: emptySection,
      enrollmentRequests: emptySection,
      auditActions: emptySection,
    });
  });
});

describe("audit trail on the user page (M10-02)", () => {
  it("is left out for admins, who can't read the audit log", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture({ role: "SUPER_ADMIN" }));
    mockAllSections();
    const result = await getUserDetailService(userId, admin);
    expect(userActivityRepository.findAuditLogsForActor).not.toHaveBeenCalled();
    expect(result.auditActions).toBeNull();
  });
});

describe("role changes are atomic and always audited (M10-06)", () => {
  it("promotes only if the role is still what was checked, with the audit row in the same transaction", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture());
    userRepository.changeRoleAudited.mockResolvedValue(userFixture({ role: "ADMIN" }));
    await promoteUserService(userId, superAdmin.id);
    expect(userRepository.changeRoleAudited).toHaveBeenCalledWith(userId, "STUDENT", "ADMIN", expect.objectContaining({ action: "USER_PROMOTED", actorUserId: superAdmin.id }));
  });

  it("refuses when the role changed in between", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture({ role: "ADMIN" }));
    userRepository.changeRoleAudited.mockResolvedValue(null);
    await expect(demoteUserService(userId, superAdmin.id)).rejects.toMatchObject({ code: "STALE_USER_ROLE" });
  });
});

describe("account access (M10-05)", () => {
  beforeEach(() => {
    userRepository.updateAccessAudited.mockImplementation(async (id, change) => userFixture({ disabledAt: change.disabledAt ?? null }));
  });

  it("signs a user out everywhere without suspending them", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture());
    await revokeUserSessionsService(userId, superAdmin.id);
    expect(userRepository.updateAccessAudited).toHaveBeenCalledWith(userId, { revokeOnly: true }, expect.objectContaining({ action: "USER_SESSIONS_REVOKED" }));
  });

  it("suspends and reactivates, audited", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture());
    await suspendUserService(userId, superAdmin.id);
    expect(userRepository.updateAccessAudited.mock.calls[0][1].disabledAt).toBeInstanceOf(Date);
    expect(userRepository.updateAccessAudited.mock.calls[0][2]).toMatchObject({ action: "USER_SUSPENDED" });

    userRepository.findUserById.mockResolvedValue(userFixture({ disabledAt: new Date() }));
    await reactivateUserService(userId, superAdmin.id);
    expect(userRepository.updateAccessAudited.mock.calls[1]).toEqual([userId, { disabledAt: null }, expect.objectContaining({ action: "USER_REACTIVATED" })]);
  });

  it("can't be used on your own account", async () => {
    await expect(suspendUserService(superAdmin.id, superAdmin.id)).rejects.toMatchObject({ code: "SELF_ACCESS_CHANGE" });
    expect(userRepository.updateAccessAudited).not.toHaveBeenCalled();
  });

  it("never suspends the last super admin who can sign in", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture({ role: "SUPER_ADMIN" }));
    userRepository.countActiveSuperAdmins.mockResolvedValue(1);
    await expect(suspendUserService(userId, superAdmin.id)).rejects.toMatchObject({ code: "LAST_SUPER_ADMIN" });
  });

  it("allows suspending a super admin while others remain", async () => {
    userRepository.findUserById.mockResolvedValue(userFixture({ role: "SUPER_ADMIN" }));
    userRepository.countActiveSuperAdmins.mockResolvedValue(3);
    await expect(suspendUserService(userId, superAdmin.id)).resolves.toMatchObject({ disabledAt: expect.any(Date) });
  });
});
