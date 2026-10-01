import { Prisma } from "@prisma/client";

/**
 * What a paid enrollment owes, from its own ledger rows — the one rule every
 * money path uses (Outstanding, reminders, "record remaining payment",
 * reactivation). Never the course's current price, which can change after
 * the student agreed to one (code review M03-01).
 *
 *   required = agreed price − the full-payment discount, if a FULL entry
 *              was recorded and not reversed (the discount is the reward for
 *              paying in one go)
 *   netPaid  = sum of every row (refunds and reversals are negative)
 *   owed     = max(0, required − netPaid)
 *
 * `enrollment` needs `agreedPrice` (falls back to `course.price` for rows
 * written before agreedPrice existed) and `payments` with
 * { id, type, amount, discountAmount, correctsPaymentId }.
 */
export function paymentBalance(enrollment) {
  const payments = enrollment.payments ?? [];
  const agreed = new Prisma.Decimal(enrollment.agreedPrice ?? enrollment.course?.price ?? 0);
  const reversedIds = new Set(payments.filter((row) => row.type === "REVERSAL").map((row) => row.correctsPaymentId));
  const standingDiscount = payments
    .filter((row) => row.type === "FULL" && !reversedIds.has(row.id))
    .reduce((sum, row) => sum.plus(row.discountAmount ?? 0), new Prisma.Decimal(0));
  const required = agreed.minus(standingDiscount);
  const netPaid = payments.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
  const owed = Prisma.Decimal.max(new Prisma.Decimal(0), required.minus(netPaid));
  return { agreed, required, netPaid, owed };
}

/** Prisma `select` for the payment rows paymentBalance needs. */
export const BALANCE_PAYMENT_SELECT = { id: true, type: true, amount: true, discountAmount: true, correctsPaymentId: true };
