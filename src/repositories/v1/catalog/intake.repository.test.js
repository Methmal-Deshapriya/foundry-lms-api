import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    course: { findUnique: vi.fn(), update: vi.fn() },
    intake: { findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    courseSession: { findMany: vi.fn(), count: vi.fn() },
    enrollment: { count: vi.fn() },
  };
  return {
    transaction,
    prisma: { $transaction: vi.fn(async (operation) => operation(transaction)) },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { create, updateSetup } from "./intake.repository.js";

const courseId = "20000000-0000-4000-8000-000000000001";
const categoryId = "20000000-0000-4000-8000-000000000003";
const intakeId = "20000000-0000-4000-8000-000000000004";

describe("intake repository invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("rejects a second intake under an Evergreen course", async () => {
    mocks.transaction.course.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-free" } })
      .mockResolvedValueOnce({
        id: courseId,
        categoryId,
        archivedAt: null,
        intakeCodePrefix: "FREE",
        category: { status: "PUBLISHED", service: { status: "ACTIVE", courseMode: "EVERGREEN" } },
        intakes: [{ id: "existing-intake" }],
      });

    await expect(create(courseId, { intakeKey: "2026-1" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.transaction.intake.create).not.toHaveBeenCalled();
  });

  it("derives the intake code from the course's prefix and the given intake key, and recomputes enrollmentStatus", async () => {
    const newIntake = { id: intakeId, courseId, code: "AI-ML-2026-1" };
    mocks.transaction.course.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({
        id: courseId,
        categoryId,
        archivedAt: null,
        intakeCodePrefix: "AI-ML",
        category: { status: "PUBLISHED", service: { status: "ACTIVE", courseMode: "SEASONAL" } },
        intakes: [],
      });
    mocks.transaction.intake.create.mockResolvedValue(newIntake);
    // recomputeCourseEnrollmentStatus's two findFirst calls, in order:
    // "any intake exists" (yes, the one just created) then "any OPEN_ACTIVE
    // intake" (no, it starts DRAFT) — together that's REOPENING_SOON.
    mocks.transaction.intake.findFirst
      .mockResolvedValueOnce(newIntake)
      .mockResolvedValueOnce(null);

    await create(courseId, {
      intakeKey: "2026-1",
      startDate: new Date("2026-09-01"),
      expectedEndDate: new Date("2026-12-01"),
      timezone: "Asia/Colombo",
    });

    expect(mocks.transaction.intake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          courseId,
          categoryId,
          intakeKey: "2026-1",
          code: "AI-ML-2026-1",
          status: "DRAFT",
        }),
      }),
    );
    expect(mocks.transaction.course.update).toHaveBeenCalledWith({
      where: { id: courseId },
      data: { enrollmentStatus: "REOPENING_SOON" },
    });
  });

  it("does not reduce capacity below the current non-cancelled learner count", async () => {
    mocks.transaction.intake.findUnique
      .mockResolvedValueOnce({ categoryId, courseId, category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({ id: intakeId, status: "OPEN_ACTIVE" });
    mocks.transaction.enrollment.count.mockResolvedValue(8);

    await expect(updateSetup(intakeId, { capacity: 7 })).rejects.toMatchObject({
      code: "INTAKE_CAPACITY_BELOW_ENROLLMENT_COUNT",
      statusCode: 409,
    });
  });
});
