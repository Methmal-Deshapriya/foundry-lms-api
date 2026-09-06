import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, ValidationError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/users/user.repository.js", () => ({
  findUserById: vi.fn(),
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
import { getUserDetailService } from "./user.service.js";

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

    const result = await getUserDetailService(userId);

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
