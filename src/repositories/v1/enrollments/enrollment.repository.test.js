import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    enrollment: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    transaction,
    prisma: { $transaction: vi.fn((callback) => callback(transaction)) },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { update } from "./enrollment.repository.js";

const id = "90000000-0000-4000-8000-000000000006";
const courseId = "90000000-0000-4000-8000-000000000004";
const batchId = "90000000-0000-4000-8000-000000000005";

function managedEnrollment(overrides = {}) {
  return {
    id,
    courseId,
    batchId,
    source: "ADMIN",
    status: "CANCELLED",
    paymentStatus: "COMPLETED",
    user: { role: "STUDENT", emailVerified: true },
    course: { status: "PUBLISHED", category: { status: "PUBLISHED" } },
    batch: { id: batchId, courseId, status: "ACTIVE" },
    certificates: [],
    ...overrides,
  };
}

describe("managed enrollment transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ courseId, batchId })
      .mockResolvedValue(managedEnrollment());
    mocks.transaction.enrollment.update.mockResolvedValue(
      managedEnrollment({ status: "ACTIVE" }),
    );
  });

  it("uses curriculum, batch, enrollment lock order and permits eligible reactivation", async () => {
    await update(
      id,
      { status: "CANCELLED", paymentStatus: "COMPLETED" },
      { status: "ACTIVE", completedAt: null },
    );

    expect(
      mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key),
    ).toEqual([
      `curriculum:${courseId}`,
      `batch:${batchId}`,
      `enrollment:${id}`,
    ]);
    expect(mocks.transaction.enrollment.update).toHaveBeenCalledTimes(1);
  });

  it.each(["COMPLETED", "ARCHIVED"])(
    "freezes enrollment writes when the parent batch is %s",
    async (batchStatus) => {
      mocks.transaction.enrollment.findUnique
        .mockReset()
        .mockResolvedValueOnce({ courseId, batchId })
        .mockResolvedValue(
          managedEnrollment({
            status: "ACTIVE",
            batch: { id: batchId, courseId, status: batchStatus },
          }),
        );

      await expect(
        update(
          id,
          { status: "ACTIVE", paymentStatus: "COMPLETED" },
          { paymentNote: "late correction" },
        ),
      ).rejects.toThrow(/history is frozen/i);
      expect(mocks.transaction.enrollment.update).not.toHaveBeenCalled();
    },
  );
});
