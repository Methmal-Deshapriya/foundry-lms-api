import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    enrollment: { findUnique: vi.fn() },
    courseSession: { findUnique: vi.fn() },
    batchSession: { findUnique: vi.fn() },
    sessionCompletion: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return {
    transaction,
    runTransaction: vi.fn((callback) => callback(transaction)),
  };
});

vi.mock("../../../utils/prisma.js", () => ({
  default: { $transaction: mocks.runTransaction },
}));

import { createCompletion, removeCompletion } from "./classroom.repository.js";

const enrollmentId = "a0000000-0000-4000-8000-000000000001";
const courseId = "a0000000-0000-4000-8000-000000000002";
const courseSessionId = "a0000000-0000-4000-8000-000000000003";

describe("classroom completion repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ courseId, batchId: null })
      .mockResolvedValue({
        courseId,
        batchId: null,
        source: "SELF",
        status: "ACTIVE",
        paymentStatus: "NOT_REQUIRED",
        batch: null,
      });
    mocks.transaction.courseSession.findUnique.mockResolvedValue({
      courseId,
      retiredAt: null,
      session: { status: "READY" },
    });
  });

  it("creates completion only after locking and rechecking active enrollment", async () => {
    const completion = { id: "completion-id" };
    mocks.transaction.sessionCompletion.create.mockResolvedValue(completion);

    const result = await createCompletion(
      enrollmentId,
      courseSessionId,
      courseId,
    );

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      `enrollment:${enrollmentId}`,
    );
    expect(mocks.transaction.sessionCompletion.create).toHaveBeenCalledWith({
      data: { enrollmentId, courseSessionId, courseId },
    });
    expect(result).toBe(completion);
  });

  it.each([createCompletion, removeCompletion])(
    "rejects a completion mutation after enrollment completion",
    async (mutate) => {
      mocks.transaction.enrollment.findUnique
        .mockReset()
        .mockResolvedValueOnce({ courseId, batchId: null })
        .mockResolvedValue({
          courseId,
          batchId: null,
          source: "SELF",
          status: "COMPLETED",
          paymentStatus: "NOT_REQUIRED",
          batch: null,
        });

      await expect(
        mutate(enrollmentId, courseSessionId, courseId),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "ENROLLMENT_COMPLETED",
      });
      expect(mocks.transaction.sessionCompletion.create).not.toHaveBeenCalled();
      expect(mocks.transaction.sessionCompletion.deleteMany).not.toHaveBeenCalled();
    },
  );

  it("removes completion under the same enrollment lock", async () => {
    mocks.transaction.sessionCompletion.deleteMany.mockResolvedValue({ count: 1 });

    const result = await removeCompletion(
      enrollmentId,
      courseSessionId,
      courseId,
    );

    expect(mocks.transaction.sessionCompletion.deleteMany).toHaveBeenCalledWith({
      where: { enrollmentId, courseSessionId },
    });
    expect(result).toEqual({ count: 1 });
  });

  it("rejects completion after the locked paid delivery has been withdrawn", async () => {
    const batchId = "a0000000-0000-4000-8000-000000000004";
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ courseId, batchId })
      .mockResolvedValue({
        courseId,
        batchId,
        source: "ADMIN",
        status: "ACTIVE",
        paymentStatus: "COMPLETED",
        batch: { status: "ACTIVE" },
      });
    mocks.transaction.batchSession.findUnique.mockResolvedValue({
      courseId,
      isReleased: false,
      availableAt: null,
    });

    await expect(
      createCompletion(enrollmentId, courseSessionId, courseId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mocks.transaction.sessionCompletion.create).not.toHaveBeenCalled();
  });

  it("keeps an archived paid classroom readable but rejects progress changes", async () => {
    const batchId = "a0000000-0000-4000-8000-000000000004";
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ courseId, batchId })
      .mockResolvedValue({
        courseId,
        batchId,
        source: "ADMIN",
        status: "ACTIVE",
        paymentStatus: "COMPLETED",
        batch: { status: "ARCHIVED" },
      });

    await expect(
      createCompletion(enrollmentId, courseSessionId, courseId),
    ).rejects.toThrow(/only while the batch is active/i);
    expect(mocks.transaction.sessionCompletion.create).not.toHaveBeenCalled();
  });
});
