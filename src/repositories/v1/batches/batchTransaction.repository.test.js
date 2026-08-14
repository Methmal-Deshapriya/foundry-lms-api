import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    batch: { findUnique: vi.fn(), update: vi.fn() },
    batchSession: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    certificate: { count: vi.fn() },
    courseSession: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    enrollment: { count: vi.fn() },
  };
  const root = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
    batch: { findUnique: vi.fn() },
    batchSession: { count: vi.fn() },
    certificate: { count: vi.fn() },
    courseSession: { count: vi.fn(), findMany: vi.fn() },
    enrollment: { count: vi.fn() },
  };
  return { root, transaction };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.root }));

import {
  transitionStatus,
  updateSetup,
  updateDelivery,
} from "./batch.repository.js";

const batchId = "70000000-0000-4000-8000-000000000001";
const courseId = "60000000-0000-4000-8000-000000000001";
const firstSessionId = "80000000-0000-4000-8000-000000000001";
const secondSessionId = "80000000-0000-4000-8000-000000000002";

const curriculum = [
  { id: firstSessionId, orderIndex: 0, session: { title: "First" } },
  { id: secondSessionId, orderIndex: 1, session: { title: "Second" } },
];

function lockKeys() {
  return mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key);
}

function arrangeDelivery({
  targetCourseId = courseId,
  deliveries = [],
  postTransactionDelivery = null,
  batchStatus = "ACTIVE",
} = {}) {
  mocks.transaction.batch.findUnique
    .mockResolvedValueOnce({ courseId })
    .mockResolvedValueOnce({ id: batchId, courseId, status: batchStatus });
  mocks.transaction.courseSession.findUnique.mockResolvedValue({
    id: secondSessionId,
    courseId: targetCourseId,
    retiredAt: null,
  });
  mocks.transaction.courseSession.findMany.mockResolvedValue(curriculum);
  mocks.transaction.batchSession.findMany.mockResolvedValue(deliveries);

  if (postTransactionDelivery) {
    mocks.root.batch.findUnique.mockResolvedValue({
      id: batchId,
      courseId,
      status: "ACTIVE",
    });
    mocks.root.courseSession.findMany.mockResolvedValue([
      {
        id: secondSessionId,
        courseId,
        orderIndex: 1,
        retiredAt: null,
        session: { title: "Second" },
        batchLinks: [postTransactionDelivery],
        _count: { completions: 0 },
      },
    ]);
  }
}

function arrangeTransition({
  currentStatus = "ACTIVE",
  certificateEnabled = true,
  curriculumCounts = [2, 2],
  enrollmentCounts = [2, 2],
  certificateCount = 2,
} = {}) {
  mocks.transaction.batch.findUnique
    .mockResolvedValueOnce({ courseId })
    .mockResolvedValueOnce({ status: currentStatus })
    .mockResolvedValueOnce({
      courseId,
      status: currentStatus,
      course: { certificateEnabled },
    });
  mocks.transaction.courseSession.count
    .mockResolvedValueOnce(curriculumCounts[0])
    .mockResolvedValueOnce(curriculumCounts[1]);
  mocks.transaction.enrollment.count
    .mockResolvedValueOnce(enrollmentCounts[0])
    .mockResolvedValueOnce(enrollmentCounts[1]);
  mocks.transaction.certificate.count.mockResolvedValue(certificateCount);
}

describe("batch transactional repository contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.$executeRaw.mockResolvedValue(1);
    mocks.transaction.batchSession.create.mockResolvedValue({});
    mocks.transaction.batchSession.update.mockResolvedValue({});
    mocks.transaction.batch.update.mockResolvedValue({});
  });

  it("locks curriculum before batch and rejects a cross-course delivery without writing", async () => {
    arrangeDelivery({ targetCourseId: "different-course" });

    await expect(
      updateDelivery(batchId, secondSessionId, {
        mode: "RELEASED",
        availableAt: null,
        acknowledgeSequenceRisk: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(lockKeys()).toEqual([`curriculum:${courseId}`, `batch:${batchId}`]);
    expect(mocks.transaction.batchSession.create).not.toHaveBeenCalled();
    expect(mocks.transaction.batchSession.update).not.toHaveBeenCalled();
  });

  it("rechecks sequence risk inside the transaction and leaves delivery unchanged", async () => {
    arrangeDelivery();

    await expect(
      updateDelivery(batchId, secondSessionId, {
        mode: "RELEASED",
        availableAt: null,
        acknowledgeSequenceRisk: false,
      }),
    ).rejects.toMatchObject({
      code: "SEQUENCE_RISK_CONFIRMATION_REQUIRED",
      details: {
        warningCode: "EARLIER_SESSIONS_UNRELEASED",
        conflicts: [{ courseSessionId: firstSessionId }],
      },
    });

    expect(mocks.transaction.courseSession.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.batchSession.create).not.toHaveBeenCalled();
    expect(mocks.transaction.batchSession.update).not.toHaveBeenCalled();
  });

  it("rejects a delivery write when the locked batch has become terminal", async () => {
    arrangeDelivery({ batchStatus: "COMPLETED" });

    await expect(
      updateDelivery(batchId, secondSessionId, {
        mode: "RELEASED",
        availableAt: null,
        acknowledgeSequenceRisk: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(mocks.transaction.batchSession.create).not.toHaveBeenCalled();
    expect(mocks.transaction.batchSession.update).not.toHaveBeenCalled();
  });

  it("rejects a scheduled timestamp that is no longer in the future", async () => {
    arrangeDelivery();

    await expect(
      updateDelivery(batchId, secondSessionId, {
        mode: "SCHEDULED",
        availableAt: new Date("2020-01-01T00:00:00.000Z"),
        acknowledgeSequenceRisk: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(mocks.transaction.batchSession.create).not.toHaveBeenCalled();
  });

  it("applies an explicitly acknowledged sequence exception atomically", async () => {
    const delivery = {
      id: "delivery-2",
      batchId,
      courseSessionId: secondSessionId,
      courseId,
      isReleased: true,
      availableAt: null,
      historicalOrderIndex: null,
    };
    arrangeDelivery({ postTransactionDelivery: delivery });

    await expect(
      updateDelivery(batchId, secondSessionId, {
        mode: "RELEASED",
        availableAt: null,
        acknowledgeSequenceRisk: true,
      }),
    ).resolves.toMatchObject({
      courseSessionId: secondSessionId,
      isReleased: true,
    });

    expect(mocks.transaction.batchSession.create).toHaveBeenCalledWith({
      data: {
        batchId,
        courseSessionId: secondSessionId,
        courseId,
        isReleased: true,
        availableAt: null,
      },
    });
    expect(lockKeys()).toEqual([`curriculum:${courseId}`, `batch:${batchId}`]);
  });

  it.each([
    {
      name: "curriculum is not fully available",
      setup: { curriculumCounts: [2, 1] },
      expectedGate: "curriculum",
    },
    {
      name: "an enrollment is incomplete",
      setup: { enrollmentCounts: [2, 1] },
      expectedGate: "enrollments",
    },
    {
      name: "a required certificate is missing",
      setup: { certificateCount: 1 },
      expectedGate: "certificates",
    },
  ])("does not complete when $name", async ({ setup, expectedGate }) => {
    arrangeTransition(setup);

    const error = await transitionStatus(batchId, "ACTIVE", "COMPLETED", {
      requireCompletionReadiness: true,
    }).catch((caught) => caught);

    expect(error).toMatchObject({ code: "CONFLICT" });
    expect(error.details[expectedGate].ready).toBe(false);
    expect(mocks.transaction.batch.update).not.toHaveBeenCalled();
    expect(mocks.transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it("completes a certificate-disabled batch after the two applicable gates pass", async () => {
    arrangeTransition({ certificateEnabled: false });
    mocks.root.batch.findUnique.mockResolvedValue({ id: batchId, status: "COMPLETED" });

    const result = await transitionStatus(batchId, "ACTIVE", "COMPLETED", {
      requireCompletionReadiness: true,
    });

    expect(result.completionReadiness).toMatchObject({
      curriculum: { ready: true },
      enrollments: { ready: true },
      certificates: { required: false, ready: true },
    });
    expect(mocks.transaction.certificate.count).not.toHaveBeenCalled();
    expect(mocks.transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.batch.update).toHaveBeenCalledWith({
      where: { id: batchId },
      data: { status: "COMPLETED" },
    });
    expect(lockKeys()).toEqual([`curriculum:${courseId}`, `batch:${batchId}`]);
  });

  it("rejects a stale expected status before readiness or lifecycle writes", async () => {
    arrangeTransition({ currentStatus: "COMPLETED" });

    await expect(
      transitionStatus(batchId, "ACTIVE", "COMPLETED", {
        requireCompletionReadiness: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(mocks.transaction.courseSession.count).not.toHaveBeenCalled();
    expect(mocks.transaction.batch.update).not.toHaveBeenCalled();
    expect(mocks.transaction.$executeRaw).not.toHaveBeenCalled();
  });

  it("rejects a setup edit after a competing lifecycle transition wins", async () => {
    mocks.transaction.batch.findUnique
      .mockResolvedValueOnce({ courseId })
      .mockResolvedValueOnce({
        id: batchId,
        courseId,
        status: "ACTIVE",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        expectedEndDate: new Date("2026-12-01T00:00:00.000Z"),
        course: {
          status: "PUBLISHED",
          category: { status: "PUBLISHED", serviceType: "BOOTCAMPS" },
        },
      });

    await expect(
      updateSetup(batchId, "DRAFT", { name: "Stale edit" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(lockKeys()).toEqual([`curriculum:${courseId}`, `batch:${batchId}`]);
    expect(mocks.transaction.batch.update).not.toHaveBeenCalled();
  });
});
