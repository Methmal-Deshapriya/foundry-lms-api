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
    enrollmentRequest: { updateMany: vi.fn(async () => ({ count: 0 })) },
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
    intake: { status: "OPEN_ACTIVE", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } },
    certificates: [],
    ...overrides,
  };
}

describe("managed enrollment transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ intakeId, intake: { serviceId: "service-paid" } })
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
      // Reactivation takes a seat, so it also holds the seat lock (M05-02).
      `intake-enrollment:${intakeId}`,
    ]);
    expect(mocks.transaction.enrollment.update).toHaveBeenCalledTimes(1);
  });

  it("refuses to reactivate into a full intake (M05-02)", async () => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { serviceId: "service-paid" } })
      .mockResolvedValueOnce(managedEnrollment({ intake: { id: intakeId, status: "OPEN_ACTIVE", capacity: 30, service: { accessType: "PAID" } } }));
    mocks.transaction.enrollment.count.mockResolvedValueOnce(30);

    await expect(
      update(id, { status: "CANCELLED", paymentStatus: "COMPLETED" }, { status: "ACTIVE", completedAt: null }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.transaction.enrollment.update).not.toHaveBeenCalled();
  });

  it("closes the student's open request for the course when enrolling them directly (M05-04)", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique.mockReset().mockResolvedValueOnce(null);
    mocks.transaction.intake.findUnique
      .mockResolvedValueOnce({ serviceId: "service-paid" })
      .mockResolvedValueOnce({
        id: intakeId, courseId, status: "OPEN_ACTIVE", capacity: null,
        course: { archivedAt: null, status: "PUBLISHED", price: 1000, currency: "LKR", discountAmount: 0 },
        service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" },
      });
    mocks.transaction.user.findUnique.mockResolvedValue({ role: "STUDENT", emailVerified: true });
    mocks.transaction.enrollment.create.mockResolvedValue({ id });
    mocks.prisma.enrollment.findUnique.mockResolvedValue(managedEnrollment({ status: "ACTIVE" }));

    await createPaid(intakeId, "student-1", "admin-1", { paymentStatus: "COMPLETED", paymentCompletedAt: new Date() });
    expect(mocks.transaction.enrollmentRequest.updateMany).toHaveBeenCalledWith({
      where: { studentUserId: "student-1", courseId, status: { in: ["PENDING", "CONTACTED"] } },
      data: { status: "ENROLLED", enrollmentId: id, intakeId },
    });
  });

  it("serializes paid enrollment against intake lifecycle and capacity edits", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique.mockReset();
    mocks.transaction.intake.findUnique
      .mockResolvedValueOnce({ serviceId: "service-paid" })
      .mockResolvedValueOnce({
        id: intakeId,
        courseId,
        status: "OPEN_ACTIVE",
        capacity: 2,
        course: { archivedAt: null, status: "PUBLISHED", price: 1000, currency: "LKR", discountAmount: 100 },
        service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" },
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
      .mockResolvedValueOnce({ serviceId: "service-paid" })
      .mockResolvedValueOnce({
        id: intakeId,
        courseId,
        status: "OPEN_ACTIVE",
        capacity: 2,
        course: { archivedAt: null, status: "PUBLISHED", price: 1000, currency: "LKR", discountAmount: 100 },
        service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" },
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
      .mockResolvedValueOnce({ serviceId: "service-paid" })
      .mockResolvedValueOnce({
        id: intakeId,
        courseId,
        status: "OPEN_ACTIVE",
        capacity: 2,
        course: { archivedAt: null, status: "PUBLISHED", price: 500, currency: "LKR", discountAmount: 1000 },
        service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" },
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
      .mockResolvedValueOnce({ intakeId, intake: { serviceId: "service-paid" } }) // lock context
      .mockResolvedValueOnce({ id, courseId, intakeId, paymentStatus: "PARTIAL", agreedPrice: 1000, course: { price: 1000, currency: "LKR" }, payments: [{ id: "p-1", type: "PARTIAL", amount: 500, discountAmount: 0, correctsPaymentId: null }] }) // current
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

  it("charges the agreed balance even after the course price was changed", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { serviceId: "service-paid" } })
      // Agreed at 30,000 and paid 15,000; the course now costs 40,000.
      .mockResolvedValueOnce({ id, courseId, intakeId, paymentStatus: "PARTIAL", agreedPrice: 30000, course: { price: 40000, currency: "LKR" }, payments: [{ id: "p-1", type: "PARTIAL", amount: 15000, discountAmount: 0, correctsPaymentId: null }] })
      .mockResolvedValueOnce(managedEnrollment({ status: "ACTIVE", paymentStatus: "COMPLETED" }));

    await completePayment(id, "admin-1");
    expect(mocks.transaction.payment.create.mock.calls[0][0].data.amount.toString()).toBe("15000");
  });

  it("makes the two halves add up to exactly the agreed price on an odd-cent price", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({ id, courseId, intakeId, paymentStatus: "PARTIAL", agreedPrice: "15000.01", course: { price: "15000.01", currency: "LKR" }, payments: [{ id: "p-1", type: "PARTIAL", amount: "7500.01", discountAmount: 0, correctsPaymentId: null }] })
      .mockResolvedValueOnce(managedEnrollment({ status: "ACTIVE", paymentStatus: "COMPLETED" }));

    await completePayment(id, "admin-1");
    expect(mocks.transaction.payment.create.mock.calls[0][0].data.amount.toString()).toBe("7500");
  });

  it("refuses to complete payment for an enrollment that isn't PARTIAL", async () => {
    vi.clearAllMocks();
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId, intake: { serviceId: "service-paid" } })
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
        .mockResolvedValueOnce({ intakeId, intake: { serviceId: "service-paid" } })
        .mockResolvedValue(
          managedEnrollment({
            status: "ACTIVE",
            intake: { status: intakeStatus, service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } },
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
