import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    enrollment: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn((callback) => callback(transaction)),
      enrollment: { findUnique: vi.fn() },
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { createPaid, update } from "./enrollment.repository.js";

const id = "90000000-0000-4000-8000-000000000006";
const courseId = "90000000-0000-4000-8000-000000000004";

function managedEnrollment(overrides = {}) {
  return {
    id,
    courseId,
    source: "ADMIN",
    status: "CANCELLED",
    paymentStatus: "COMPLETED",
    user: { role: "STUDENT", emailVerified: true },
    course: { status: "OPEN_ACTIVE", category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } } },
    certificates: [],
    ...overrides,
  };
}

describe("managed enrollment transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ courseId, course: { category: { serviceId: "service-paid" } } })
      .mockResolvedValue(managedEnrollment());
    mocks.transaction.enrollment.update.mockResolvedValue(
      managedEnrollment({ status: "ACTIVE" }),
    );
  });

  it("uses course then enrollment lock order and permits eligible reactivation", async () => {
    await update(
      id,
      { status: "CANCELLED", paymentStatus: "COMPLETED" },
      { status: "ACTIVE", completedAt: null },
    );

    expect(
      mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key),
    ).toEqual([
      "learning-service:service-paid",
      `course:${courseId}`,
      `enrollment:${id}`,
    ]);
    expect(mocks.transaction.enrollment.update).toHaveBeenCalledTimes(1);
  });

  it("serializes paid enrollment against course lifecycle and capacity edits", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique.mockReset();
    mocks.transaction.course.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({
        id: courseId,
        status: "OPEN_ACTIVE",
        capacity: 2,
        courseGroup: { archivedAt: null },
        category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } },
      });
    mocks.transaction.user.findUnique.mockResolvedValue({ role: "STUDENT", emailVerified: true });
    mocks.transaction.enrollment.findUnique.mockResolvedValue(null);
    mocks.transaction.enrollment.count.mockResolvedValue(1);
    mocks.transaction.enrollment.create.mockResolvedValue({ id });
    mocks.prisma.enrollment.findUnique.mockResolvedValue(managedEnrollment({ status: "ACTIVE" }));

    await createPaid(courseId, "student-1", "admin-1", {
      paymentStatus: "COMPLETED",
      paymentCompletedAt: new Date(),
    });

    expect(mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key)).toEqual([
      "learning-service:service-paid",
      `course:${courseId}`,
      `course-enrollment:${courseId}`,
    ]);
  });

  it.each(["COMPLETED", "ARCHIVED"])(
    "freezes enrollment writes when the parent course is %s",
    async (courseStatus) => {
      mocks.transaction.enrollment.findUnique
        .mockReset()
        .mockResolvedValueOnce({ courseId, course: { category: { serviceId: "service-paid" } } })
        .mockResolvedValue(
          managedEnrollment({
            status: "ACTIVE",
            course: { status: courseStatus, category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } } },
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
