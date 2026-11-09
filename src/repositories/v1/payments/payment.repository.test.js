import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    payment: { findUnique: vi.fn(), create: vi.fn() },
    enrollment: { findUnique: vi.fn(), update: vi.fn() },
    expense: { findUnique: vi.fn(), create: vi.fn() },
    payout: { findUnique: vi.fn(), create: vi.fn() },
  };
  return { transaction, prisma: { $transaction: vi.fn(async (operation) => operation(transaction)) } };
});
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { createRefund, createReversal } from "./payment.repository.js";
import { reverseExpense, reversePayout } from "../partners/partner.repository.js";

const enrollmentId = "e-1";
const marchPaidAt = new Date("2026-03-01T06:00:00.000Z");

function original(overrides = {}) {
  return {
    id: "pay-1", enrollmentId, courseId: "c-1", intakeId: "i-1", type: "FULL", amount: 27000, currency: "LKR", method: "CASH",
    paidAt: marchPaidAt, corrections: [], enrollment: { status: "CANCELLED", paymentStatus: "COMPLETED" }, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  mocks.transaction.payment.create.mockResolvedValue({ id: "rev-1" });
  // lockEnrollment context
  mocks.transaction.enrollment.findUnique.mockResolvedValue({ intakeId: "i-1", intake: { serviceId: "s-1" } });
});

describe("payment reversal", () => {
  it("is dated on the original's date, not today (M03-04)", async () => {
    mocks.transaction.payment.findUnique.mockResolvedValueOnce({ enrollmentId }).mockResolvedValueOnce(original());
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ intakeId: "i-1", intake: { serviceId: "s-1" } })
      .mockResolvedValueOnce({ agreedPrice: 30000, course: { price: 30000 }, payments: [] });

    await createReversal("pay-1", "admin-1", { reason: "Wrong student" });
    expect(mocks.transaction.payment.create.mock.calls[0][0].data).toMatchObject({ type: "REVERSAL", paidAt: marchPaidAt, correctsPaymentId: "pay-1" });
  });

  it("moves a paid enrollment to 'still owes' once its payment is reversed (M03-08)", async () => {
    mocks.transaction.payment.findUnique.mockResolvedValueOnce({ enrollmentId }).mockResolvedValueOnce(original());
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ intakeId: "i-1", intake: { serviceId: "s-1" } })
      .mockResolvedValueOnce({
        agreedPrice: 30000,
        course: { price: 30000 },
        payments: [
          { id: "pay-1", type: "FULL", amount: 27000, discountAmount: 3000, correctsPaymentId: null },
          { id: "rev-1", type: "REVERSAL", amount: -27000, discountAmount: 0, correctsPaymentId: "pay-1" },
        ],
      });

    await createReversal("pay-1", "admin-1", { reason: "Wrong student" });
    expect(mocks.transaction.enrollment.update).toHaveBeenCalledWith({ where: { id: enrollmentId }, data: { paymentStatus: "PARTIAL", paymentCompletedAt: null } });
  });

  it("can't reverse the first payment of a student who is still enrolled", async () => {
    mocks.transaction.payment.findUnique
      .mockResolvedValueOnce({ enrollmentId })
      .mockResolvedValueOnce(original({ enrollment: { status: "ACTIVE", paymentStatus: "COMPLETED" } }));
    await expect(createReversal("pay-1", "admin-1", { reason: "x" })).rejects.toMatchObject({ code: "ENROLLMENT_NOT_CANCELLED" });
    expect(mocks.transaction.payment.create).not.toHaveBeenCalled();
  });

  it("can't reverse twice", async () => {
    mocks.transaction.payment.findUnique
      .mockResolvedValueOnce({ enrollmentId })
      .mockResolvedValueOnce(original({ corrections: [{ type: "REVERSAL", amount: -27000 }] }));
    await expect(createReversal("pay-1", "admin-1", { reason: "x" })).rejects.toMatchObject({ code: "PAYMENT_ALREADY_REVERSED" });
  });
});

describe("refunds", () => {
  it("are capped at what is left of the original payment", async () => {
    mocks.transaction.payment.findUnique
      .mockResolvedValueOnce({ enrollmentId })
      .mockResolvedValueOnce(original({ enrollment: undefined, corrections: [{ type: "REFUND", amount: -20000 }] }));
    await expect(createRefund("pay-1", "admin-1", { amount: 8000, reason: "Left early" })).rejects.toMatchObject({ code: "REFUND_EXCEEDS_PAYMENT" });
  });

  it("can't refund a refund", async () => {
    mocks.transaction.payment.findUnique.mockResolvedValueOnce({ enrollmentId }).mockResolvedValueOnce(original({ type: "REFUND" }));
    await expect(createRefund("pay-1", "admin-1", { amount: 1, reason: "x" })).rejects.toMatchObject({ code: "PAYMENT_NOT_CORRECTABLE" });
  });
});

describe("expense and payout reversals (M03-03)", () => {
  it("lock the expense before checking whether it was already reversed", async () => {
    mocks.transaction.expense.findUnique.mockResolvedValue({ id: "x-1", kind: "ENTRY", amount: 500, corrections: [] });
    mocks.transaction.expense.create.mockResolvedValue({ id: "x-2" });
    await reverseExpense("x-1", "admin-1", "Duplicate");
    const lockCall = mocks.transaction.$queryRawUnsafe.mock.invocationCallOrder[0];
    const readCall = mocks.transaction.expense.findUnique.mock.invocationCallOrder[0];
    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), "expense-reversal:x-1");
    expect(lockCall).toBeLessThan(readCall);
  });

  it("lock the payout the same way", async () => {
    mocks.transaction.payout.findUnique.mockResolvedValue({ id: "o-1", kind: "ENTRY", amount: 500, corrections: [] });
    mocks.transaction.payout.create.mockResolvedValue({ id: "o-2" });
    await reversePayout("o-1", "admin-1", "Duplicate");
    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), "payout-reversal:o-1");
  });

  it("refuse a second reversal", async () => {
    mocks.transaction.expense.findUnique.mockResolvedValue({ id: "x-1", kind: "ENTRY", amount: 500, corrections: [{ id: "x-2" }] });
    await expect(reverseExpense("x-1", "admin-1", "Again")).rejects.toMatchObject({ code: "EXPENSE_ALREADY_REVERSED" });
  });
});
