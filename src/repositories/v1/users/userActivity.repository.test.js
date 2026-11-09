import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enrollmentCount: vi.fn(),
  enrollmentFindMany: vi.fn(),
  paymentCount: vi.fn(),
  paymentFindMany: vi.fn(),
  certificateCount: vi.fn(),
  certificateFindMany: vi.fn(),
  studentProjectCount: vi.fn(),
  studentProjectFindMany: vi.fn(),
  enrollmentRequestCount: vi.fn(),
  enrollmentRequestFindMany: vi.fn(),
  auditLogCount: vi.fn(),
  auditLogFindMany: vi.fn(),
}));

vi.mock("../../../utils/prisma.js", () => ({
  default: {
    enrollment: { count: mocks.enrollmentCount, findMany: mocks.enrollmentFindMany },
    payment: { count: mocks.paymentCount, findMany: mocks.paymentFindMany },
    certificate: { count: mocks.certificateCount, findMany: mocks.certificateFindMany },
    studentProject: { count: mocks.studentProjectCount, findMany: mocks.studentProjectFindMany },
    enrollmentRequest: { count: mocks.enrollmentRequestCount, findMany: mocks.enrollmentRequestFindMany },
    auditLog: { count: mocks.auditLogCount, findMany: mocks.auditLogFindMany },
  },
}));

import {
  findAuditLogsForActor,
  findCertificatesForUser,
  findEnrollmentRequestsForUser,
  findEnrollmentsForUser,
  findManagedEnrollmentsForUser,
  findPaymentsForUser,
  findPaymentsRecordedByUser,
  findStudentProjectsForUser,
} from "./userActivity.repository.js";
import { queryShapeProblems } from "../../../testUtils/prismaShape.js";

const userId = "90000000-0000-4000-8000-000000000001";

describe("user activity repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bounds enrollments-as-student to the given limit and reports the true total", async () => {
    mocks.enrollmentCount.mockResolvedValue(12);
    mocks.enrollmentFindMany.mockResolvedValue([{ id: "e1" }]);

    const result = await findEnrollmentsForUser(userId, 5);

    expect(mocks.enrollmentCount).toHaveBeenCalledWith({ where: { userId } });
    expect(mocks.enrollmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId }, take: 5 }),
    );
    expect(result).toEqual({ total: 12, items: [{ id: "e1" }] });
  });

  it("scopes managed enrollments by enrolledByUserId, not userId", async () => {
    mocks.enrollmentCount.mockResolvedValue(2);
    mocks.enrollmentFindMany.mockResolvedValue([]);

    await findManagedEnrollmentsForUser(userId, 5);

    expect(mocks.enrollmentCount).toHaveBeenCalledWith({ where: { enrolledByUserId: userId } });
    expect(mocks.enrollmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enrolledByUserId: userId } }),
    );
  });

  it("scopes payments recorded by this admin separately from payments made for their own enrollments", async () => {
    mocks.paymentCount.mockResolvedValue(1);
    mocks.paymentFindMany.mockResolvedValue([]);

    await findPaymentsRecordedByUser(userId, 5);
    expect(mocks.paymentCount).toHaveBeenCalledWith({ where: { recordedByUserId: userId } });

    await findPaymentsForUser(userId, 5);
    expect(mocks.paymentCount).toHaveBeenCalledWith({ where: { enrollment: { userId } } });
  });

  it("scopes certificates through the user's own enrollments", async () => {
    mocks.certificateCount.mockResolvedValue(1);
    mocks.certificateFindMany.mockResolvedValue([]);

    await findCertificatesForUser(userId, 5);

    expect(mocks.certificateCount).toHaveBeenCalledWith({ where: { enrollment: { userId } } });
  });

  it("scopes student projects and enrollment requests directly by user id", async () => {
    mocks.studentProjectCount.mockResolvedValue(0);
    mocks.studentProjectFindMany.mockResolvedValue([]);
    mocks.enrollmentRequestCount.mockResolvedValue(0);
    mocks.enrollmentRequestFindMany.mockResolvedValue([]);

    await findStudentProjectsForUser(userId, 5);
    expect(mocks.studentProjectCount).toHaveBeenCalledWith({ where: { userId } });

    await findEnrollmentRequestsForUser(userId, 5);
    expect(mocks.enrollmentRequestCount).toHaveBeenCalledWith({ where: { studentUserId: userId } });
  });

  it("scopes audit log activity by actorUserId with a default limit of 10", async () => {
    mocks.auditLogCount.mockResolvedValue(0);
    mocks.auditLogFindMany.mockResolvedValue([]);

    await findAuditLogsForActor(userId);

    expect(mocks.auditLogCount).toHaveBeenCalledWith({ where: { actorUserId: userId } });
    expect(mocks.auditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { actorUserId: userId }, take: 10 }),
    );
  });
});

describe("user activity query shapes match the real schema (M10-01)", () => {
  it("catches a removed relation", () => {
    expect(queryShapeProblems("Enrollment", { include: { course: { include: { category: true } } } })).toEqual([
      "Enrollment.course.category: no such field on Course",
    ]);
  });

  it("every section's query uses fields that exist", async () => {
    for (const fn of [mocks.enrollmentCount, mocks.paymentCount, mocks.certificateCount, mocks.studentProjectCount, mocks.enrollmentRequestCount, mocks.auditLogCount]) fn.mockResolvedValue(0);
    for (const fn of [mocks.enrollmentFindMany, mocks.paymentFindMany, mocks.certificateFindMany, mocks.studentProjectFindMany, mocks.enrollmentRequestFindMany, mocks.auditLogFindMany]) fn.mockResolvedValue([]);
    await Promise.all([
      findEnrollmentsForUser(userId),
      findManagedEnrollmentsForUser(userId),
      findPaymentsRecordedByUser(userId),
      findPaymentsForUser(userId),
      findCertificatesForUser(userId),
      findStudentProjectsForUser(userId),
      findEnrollmentRequestsForUser(userId),
      findAuditLogsForActor(userId),
    ]);
    const calls = [
      ["Enrollment", mocks.enrollmentFindMany],
      ["Payment", mocks.paymentFindMany],
      ["Certificate", mocks.certificateFindMany],
      ["StudentProject", mocks.studentProjectFindMany],
      ["EnrollmentRequest", mocks.enrollmentRequestFindMany],
      ["AuditLog", mocks.auditLogFindMany],
    ];
    for (const [model, fn] of calls) {
      expect(fn).toHaveBeenCalled();
      for (const [args] of fn.mock.calls) expect(queryShapeProblems(model, args)).toEqual([]);
    }
  });
});
