import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    intake: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    enrollment: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: { create: vi.fn() },
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

import { completePayment, createPaid, update } from "./enrollment.repository.js";

const id = "90000000-0000-4000-8000-000000000006";
const courseId = "90000000-0000-4000-8000-000000000004";
const intakeId = "90000000-0000-4000-8000-000000000005";

function managedEnrollment(overrides = {}) {
  return {
    id,
    courseId,
    intakeId,
    source: "ADMIN",
    status: "CANCELLED",
    paymentStatus: "COMPLETED",
    user: { role: "STUDENT", emailVerified: true },
    intake: { status: "OPEN_ACTIVE", category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } } },
    certificates: [],
    ...overrides,
  };
}

describe("managed enrollment transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-paid" } } })
      .mockResolvedValue(managedEnrollment());
    mocks.transaction.enrollment.update.mockResolvedValue(
      managedEnrollment({ status: "ACTIVE" }),
    );
  });

  it("uses intake then enrollment lock order and permits eligible reactivation", async () => {
    await update(
      id,
      { status: "CANCELLED", paymentStatus: "COMPLETED" },
      { status: "ACTIVE", completedAt: null },
    );

    expect(
      mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key),
    ).toEqual([
      "learning-service:service-paid",
      `intake:${intakeId}`,
      `enrollment:${id}`,
    ]);
    expect(mocks.transaction.enrollment.update).toHaveBeenCalledTimes(1);
  });

  it("serializes paid enrollment against intake lifecycle and capacity edits", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique.mockReset();
    mocks.transaction.intake.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({
        id: intakeId,
        courseId,
        status: "OPEN_ACTIVE",
        capacity: 2,
        course: { archivedAt: null, price: 1000, currency: "LKR", discountAmount: 100 },
        category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } },
      });
    mocks.transaction.user.findUnique.mockResolvedValue({ role: "STUDENT", emailVerified: true });
    mocks.transaction.enrollment.findUnique.mockResolvedValue(null);
    mocks.transaction.enrollment.count.mockResolvedValue(1);
    mocks.transaction.enrollment.create.mockResolvedValue({ id });
    mocks.prisma.enrollment.findUnique.mockResolvedValue(managedEnrollment({ status: "ACTIVE" }));

    await createPaid(intakeId, "student-1", "admin-1", {
      paymentStatus: "COMPLETED",
      paymentCompletedAt: new Date(),
    });

    expect(mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key)).toEqual([
      "learning-service:service-paid",
      `intake:${intakeId}`,
      `intake-enrollment:${intakeId}`,
    ]);
    expect(mocks.transaction.enrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ courseId, intakeId }),
    }));
    expect(mocks.transaction.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollmentId: id,
        courseId,
        intakeId,
        recordedByUserId: "admin-1",
        type: "FULL",
        currency: "LKR",
      }),
    });
    const paidEntry = mocks.transaction.payment.create.mock.calls[0][0].data;
    expect(paidEntry.amount.toString()).toBe("900"); // 1000 price - 100 discount
    expect(paidEntry.discountAmount.toString()).toBe("100");
  });

  it("records a half-price PARTIAL payment with no discount at enrollment time", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique.mockReset();
    mocks.transaction.intake.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({
        id: intakeId,
        courseId,
        status: "OPEN_ACTIVE",
        capacity: 2,
        course: { archivedAt: null, price: 1000, currency: "LKR", discountAmount: 100 },
        category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } },
      });
    mocks.transaction.user.findUnique.mockResolvedValue({ role: "STUDENT", emailVerified: true });
    mocks.transaction.enrollment.findUnique.mockResolvedValue(null);
    mocks.transaction.enrollment.count.mockResolvedValue(1);
    mocks.transaction.enrollment.create.mockResolvedValue({ id });
    mocks.prisma.enrollment.findUnique.mockResolvedValue(managedEnrollment({ status: "ACTIVE", paymentStatus: "PARTIAL" }));

    await createPaid(intakeId, "student-1", "admin-1", { paymentStatus: "PARTIAL" });

    const paidEntry = mocks.transaction.payment.create.mock.calls[0][0].data;
    expect(paidEntry.type).toBe("PARTIAL");
    expect(paidEntry.amount.toString()).toBe("500"); // half of 1000, no discount
    expect(paidEntry.discountAmount.toString()).toBe("0");
  });

  it("refuses a FULL payment when the discount would exceed the course price", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique.mockReset();
    mocks.transaction.intake.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({
        id: intakeId,
        courseId,
        status: "OPEN_ACTIVE",
        capacity: 2,
        course: { archivedAt: null, price: 500, currency: "LKR", discountAmount: 1000 },
        category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } },
      });
    mocks.transaction.user.findUnique.mockResolvedValue({ role: "STUDENT", emailVerified: true });
    mocks.transaction.enrollment.findUnique.mockResolvedValue(null);
    mocks.transaction.enrollment.count.mockResolvedValue(1);
    mocks.transaction.enrollment.create.mockResolvedValue({ id });

    await expect(
      createPaid(intakeId, "student-1", "admin-1", { paymentStatus: "COMPLETED" }),
    ).rejects.toMatchObject({ code: "PRICE_BELOW_DISCOUNT" });
    expect(mocks.transaction.payment.create).not.toHaveBeenCalled();
  });

  it("records a TOP_UP payment for the remaining half and completes a PARTIAL enrollment", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-paid" } } }) // lock context
      .mockResolvedValueOnce({ id, courseId, intakeId, paymentStatus: "PARTIAL", course: { price: 1000, currency: "LKR" } }) // current
      .mockResolvedValueOnce(managedEnrollment({ status: "ACTIVE", paymentStatus: "COMPLETED" })); // final refetch

    await completePayment(id, "admin-1");

    expect(mocks.transaction.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ enrollmentId: id, courseId, intakeId, recordedByUserId: "admin-1", type: "TOP_UP", currency: "LKR" }),
    });
    const entry = mocks.transaction.payment.create.mock.calls[0][0].data;
    expect(entry.amount.toString()).toBe("500");
    expect(entry.discountAmount.toString()).toBe("0");
    expect(mocks.transaction.enrollment.update).toHaveBeenCalledWith({
      where: { id },
      data: { paymentStatus: "COMPLETED", paymentCompletedAt: expect.any(Date) },
    });
  });

  it("refuses to complete payment for an enrollment that isn't PARTIAL", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-paid" } } })
      .mockResolvedValueOnce({ id, courseId, intakeId, paymentStatus: "COMPLETED", course: { price: 1000, currency: "LKR" } });

    await expect(completePayment(id, "admin-1")).rejects.toMatchObject({ code: "PAYMENT_NOT_PARTIAL" });
    expect(mocks.transaction.payment.create).not.toHaveBeenCalled();
    expect(mocks.transaction.enrollment.update).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "ARCHIVED"])(
    "freezes enrollment writes when the parent intake is %s",
    async (intakeStatus) => {
      mocks.transaction.enrollment.findUnique
        .mockReset()
        .mockResolvedValueOnce({ intakeId, intake: { category: { serviceId: "service-paid" } } })
        .mockResolvedValue(
          managedEnrollment({
            status: "ACTIVE",
            intake: { status: intakeStatus, category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } } },
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
