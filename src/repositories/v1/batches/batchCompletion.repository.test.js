import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findBatch: vi.fn(),
  countCourseSessions: vi.fn(),
  countBatchSessions: vi.fn(),
  countEnrollments: vi.fn(),
  countCertificates: vi.fn(),
}));

vi.mock("../../../utils/prisma.js", () => ({
  default: {
    batch: { findUnique: mocks.findBatch },
    courseSession: { count: mocks.countCourseSessions },
    batchSession: { count: mocks.countBatchSessions },
    enrollment: { count: mocks.countEnrollments },
    certificate: { count: mocks.countCertificates },
  },
}));

import { findCompletionReadiness } from "./batch.repository.js";

const batchId = "90000000-0000-4000-8000-000000000001";
const courseId = "90000000-0000-4000-8000-000000000002";

function arrange({ certificateEnabled, issued = 0 }) {
  mocks.findBatch.mockResolvedValue({
    courseId,
    status: "ACTIVE",
    course: { certificateEnabled },
  });
  mocks.countCourseSessions
    .mockResolvedValueOnce(2)
    .mockResolvedValueOnce(2);
  mocks.countEnrollments
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(3);
  mocks.countCertificates.mockResolvedValue(issued);
}

describe("batch certificate completion readiness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("treats certificates as not applicable when the course disabled them", async () => {
    arrange({ certificateEnabled: false });

    const readiness = await findCompletionReadiness(batchId);

    expect(readiness.certificates).toEqual({
      required: false,
      enabled: false,
      issued: 0,
      ready: true,
    });
    expect(mocks.countCertificates).not.toHaveBeenCalled();
  });

  it("blocks a certificate-bearing batch until every enrollment is certified", async () => {
    arrange({ certificateEnabled: true, issued: 2 });

    const readiness = await findCompletionReadiness(batchId);

    expect(readiness.certificates).toMatchObject({
      required: true,
      enabled: true,
      issued: 2,
      ready: false,
    });
  });

  it("marks certificate readiness complete when every enrollment is certified", async () => {
    arrange({ certificateEnabled: true, issued: 3 });

    const readiness = await findCompletionReadiness(batchId);

    expect(readiness.certificates.ready).toBe(true);
  });

  it("does not consider an empty batch ready to complete", async () => {
    mocks.findBatch.mockResolvedValue({
      courseId,
      status: "ACTIVE",
      course: { certificateEnabled: false },
    });
    mocks.countCourseSessions
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2);
    mocks.countEnrollments
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const readiness = await findCompletionReadiness(batchId);

    expect(readiness.enrollments).toEqual({
      total: 0,
      completed: 0,
      ready: false,
    });
  });
});
