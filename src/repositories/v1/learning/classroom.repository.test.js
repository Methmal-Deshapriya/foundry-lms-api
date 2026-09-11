import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    enrollment: { findUnique: vi.fn() },
    courseSession: { findFirst: vi.fn() },
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
const intakeId = "a0000000-0000-4000-8000-000000000002";
const courseSessionId = "a0000000-0000-4000-8000-000000000003";

describe("classroom completion repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-1" } } })
      .mockResolvedValue({
        intakeId,
        source: "SELF",
        status: "ACTIVE",
        paymentStatus: "NOT_REQUIRED",
        intake: { status: "OPEN_ACTIVE", category: { service: { accessType: "FREE", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" } } },
      });
    mocks.transaction.courseSession.findFirst.mockResolvedValue({ id: courseSessionId });
  });

  it("creates completion only after locking and rechecking active enrollment", async () => {
    const completion = { id: "completion-id" };
    mocks.transaction.sessionCompletion.create.mockResolvedValue(completion);

    const result = await createCompletion(
      enrollmentId,
      courseSessionId,
      intakeId,
    );

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      `enrollment:${enrollmentId}`,
    );
    expect(mocks.transaction.sessionCompletion.create).toHaveBeenCalledWith({
      data: { enrollmentId, courseSessionId, intakeId },
    });
    expect(result).toBe(completion);
  });

  it("allows marking completion for a partially paid enrollment, same as a fully paid one", async () => {
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-1" } } })
      .mockResolvedValue({
        intakeId,
        source: "ADMIN",
        status: "ACTIVE",
        paymentStatus: "PARTIAL",
        intake: { status: "OPEN_ACTIVE", category: { service: { accessType: "PAID", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } } },
      });
    mocks.transaction.courseSession.findFirst.mockResolvedValue({ id: courseSessionId });
    mocks.transaction.sessionCompletion.create.mockResolvedValue({ id: "completion-id" });

    await createCompletion(enrollmentId, courseSessionId, intakeId);

    expect(mocks.transaction.sessionCompletion.create).toHaveBeenCalledWith({
      data: { enrollmentId, courseSessionId, intakeId },
    });
  });

  it.each([createCompletion, removeCompletion])(
    "rejects a completion mutation after enrollment completion",
    async (mutate) => {
      mocks.transaction.enrollment.findUnique
        .mockReset()
        .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-1" } } })
        .mockResolvedValue({
          intakeId,
          source: "SELF",
          status: "COMPLETED",
          paymentStatus: "NOT_REQUIRED",
          intake: { status: "OPEN_ACTIVE", category: { service: { accessType: "FREE", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" } } },
        });

      await expect(
        mutate(enrollmentId, courseSessionId, intakeId),
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
      intakeId,
    );

    expect(mocks.transaction.sessionCompletion.deleteMany).toHaveBeenCalledWith({
      where: { enrollmentId, courseSessionId },
    });
    expect(result).toEqual({ count: 1 });
  });

  it("rejects completion after the locked intake delivery has been withdrawn", async () => {
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-1" } } })
      .mockResolvedValue({
        intakeId,
        source: "ADMIN",
        status: "ACTIVE",
        paymentStatus: "COMPLETED",
        intake: { status: "OPEN_ACTIVE", category: { service: { accessType: "PAID", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } } },
      });
    mocks.transaction.courseSession.findFirst.mockResolvedValue(null);

    await expect(
      createCompletion(enrollmentId, courseSessionId, intakeId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mocks.transaction.sessionCompletion.create).not.toHaveBeenCalled();
  });

  it("keeps archived history readable but rejects progress changes", async () => {
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-1" } } })
      .mockResolvedValue({
        intakeId,
        source: "ADMIN",
        status: "ACTIVE",
        paymentStatus: "COMPLETED",
        intake: { status: "ARCHIVED", category: { service: { accessType: "PAID" } } },
      });

    await expect(
      createCompletion(enrollmentId, courseSessionId, intakeId),
    ).rejects.toThrow(/while the intake is active/i);
    expect(mocks.transaction.sessionCompletion.create).not.toHaveBeenCalled();
  });
});
