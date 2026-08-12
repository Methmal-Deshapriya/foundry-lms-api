import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    batch: { findUnique: vi.fn() },
    course: { findFirst: vi.fn() },
    enrollment: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    transaction,
    runTransaction: vi.fn((callback) => callback(transaction)),
    findUnique: vi.fn(),
  };
});

vi.mock("../../../utils/prisma.js", () => ({
  default: {
    $transaction: mocks.runTransaction,
    enrollment: { findUnique: mocks.findUnique },
  },
}));

import { createPaid, enrollFree, update } from "./enrollment.repository.js";

const userId = "90000000-0000-4000-8000-000000000001";
const courseId = "90000000-0000-4000-8000-000000000002";
const enrollmentId = "90000000-0000-4000-8000-000000000003";

describe("Free Learning enrollment repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.course.findFirst.mockResolvedValue({ id: courseId });
    mocks.transaction.enrollment.findUnique.mockResolvedValue({
      id: enrollmentId,
      status: "ACTIVE",
      paymentStatus: "COMPLETED",
    });
    mocks.findUnique.mockResolvedValue({ id: enrollmentId, status: "ACTIVE" });
  });

  it("reactivates the existing row inside the enrollment lock", async () => {
    mocks.transaction.enrollment.findFirst.mockResolvedValue({
      id: enrollmentId,
      status: "CANCELLED",
      paymentStatus: "NOT_REQUIRED",
    });
    mocks.transaction.enrollment.findUnique.mockResolvedValue({
      id: enrollmentId,
      status: "CANCELLED",
    });

    const result = await enrollFree(userId, courseId);

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      `free-enrollment:${courseId}`,
    );
    expect(mocks.transaction.enrollment.update).toHaveBeenCalledWith({
      where: { id: enrollmentId },
      data: { status: "ACTIVE", completedAt: null },
    });
    expect(mocks.transaction.enrollment.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      enrollment: { id: enrollmentId, status: "ACTIVE" },
      outcome: "REACTIVATED",
    });
  });

  it("updates enrollment state only while the expected status still matches", async () => {
    const updated = { id: enrollmentId, status: "COMPLETED" };
    const completedAt = new Date();
    mocks.transaction.enrollment.update.mockResolvedValue(updated);

    const result = await update(
      enrollmentId,
      { status: "ACTIVE", paymentStatus: "COMPLETED" },
      { status: "COMPLETED", completedAt },
    );

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      `enrollment:${enrollmentId}`,
    );
    expect(result).toBe(updated);
  });

  it("rejects an enrollment update after a concurrent status change", async () => {
    mocks.transaction.enrollment.findUnique.mockResolvedValue({
      status: "COMPLETED",
      paymentStatus: "COMPLETED",
    });

    await expect(
      update(
        enrollmentId,
        { status: "ACTIVE", paymentStatus: "COMPLETED" },
        { status: "CANCELLED" },
      ),
    ).rejects.toThrow(/status changed/i);
    expect(mocks.transaction.enrollment.update).not.toHaveBeenCalled();
  });

  it("rejects completion after a concurrent payment-status change", async () => {
    mocks.transaction.enrollment.findUnique.mockResolvedValue({
      status: "ACTIVE",
      paymentStatus: "PARTIAL",
    });

    await expect(
      update(
        enrollmentId,
        { status: "ACTIVE", paymentStatus: "COMPLETED" },
        { status: "COMPLETED", completedAt: new Date() },
      ),
    ).rejects.toThrow(/payment status changed/i);
    expect(mocks.transaction.enrollment.update).not.toHaveBeenCalled();
  });

  it("returns an existing live enrollment without writing", async () => {
    mocks.transaction.enrollment.findFirst.mockResolvedValue({
      id: enrollmentId,
      status: "ACTIVE",
    });

    const result = await enrollFree(userId, courseId);

    expect(mocks.transaction.enrollment.update).not.toHaveBeenCalled();
    expect(mocks.transaction.enrollment.create).not.toHaveBeenCalled();
    expect(result.outcome).toBe("EXISTING");
  });

  it("creates one enrollment when no prior relationship exists", async () => {
    mocks.transaction.enrollment.findFirst.mockResolvedValue(null);
    mocks.transaction.enrollment.create.mockResolvedValue({ id: enrollmentId });

    const result = await enrollFree(userId, courseId);

    expect(mocks.transaction.enrollment.create).toHaveBeenCalledWith({
      data: {
        userId,
        courseId,
        batchId: null,
        source: "SELF",
        enrolledByUserId: null,
        status: "ACTIVE",
        paymentStatus: "NOT_REQUIRED",
      },
      select: { id: true },
    });
    expect(result.outcome).toBe("CREATED");
  });

  it("reports an authoritative capacity result from inside the batch lock", async () => {
    mocks.transaction.batch.findUnique.mockResolvedValue({
      id: "batch-1",
      courseId,
      capacity: 50,
    });
    mocks.transaction.enrollment.findFirst.mockResolvedValue(null);
    mocks.transaction.enrollment.count.mockResolvedValue(50);

    await expect(
      createPaid("batch-1", userId, "admin-1", {
        paymentStatus: "COMPLETED",
      }),
    ).rejects.toMatchObject({
      code: "BATCH_CAPACITY_REACHED",
      statusCode: 409,
    });

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      "batch-enrollment:batch-1",
    );
    expect(mocks.transaction.enrollment.create).not.toHaveBeenCalled();
  });
});
