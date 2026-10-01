import { Prisma } from "@prisma/client";
import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

/**
 * Payment Ledger Repository — super-admin finance workspace. Payments are
 * append-only: nothing here updates an amount or deletes a row.
 */

const ledgerInclude = {
  enrollment: {
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
    },
  },
  course: { select: { id: true, title: true, price: true, service: { select: { id: true, title: true } } } },
  intake: { select: { id: true, code: true } },
  recordedBy: { select: { firstName: true, lastName: true } },
  proofObject: true,
  corrects: { select: { id: true, type: true, amount: true, receiptSequence: true, paidAt: true } },
  corrections: { select: { id: true, type: true, amount: true, receiptSequence: true, paidAt: true, note: true }, orderBy: { createdAt: "asc" } },
};

export function ledgerWhere({ from, to, serviceId, courseId, intakeId, method, type, q }) {
  const paidAt = {};
  if (from) paidAt.gte = new Date(from);
  if (to) paidAt.lte = new Date(to);
  const receipt = q?.match(/(\d{1,9})\s*$/)?.[1];
  return {
    ...(Object.keys(paidAt).length ? { paidAt } : {}),
    ...(courseId ? { courseId } : {}),
    ...(intakeId ? { intakeId } : {}),
    ...(serviceId ? { course: { serviceId } } : {}),
    ...(method ? { method: method === "NONE" ? null : method } : {}),
    ...(type ? { type } : {}),
    ...(q
      ? {
          OR: [
            { enrollment: { user: { email: { contains: q, mode: "insensitive" } } } },
            { enrollment: { user: { firstName: { contains: q, mode: "insensitive" } } } },
            { enrollment: { user: { lastName: { contains: q, mode: "insensitive" } } } },
            { externalReference: { contains: q, mode: "insensitive" } },
            ...(receipt ? [{ receiptSequence: Number(receipt) }] : []),
          ],
        }
      : {}),
  };
}

// The per-type totals (and the type pills' counts) apply every filter
// EXCEPT the type itself, so switching type pills doesn't change the other
// pills' numbers — same shared/full-where split the other admin tables use.
export async function findLedgerPage(filters) {
  const where = ledgerWhere(filters);
  const sharedWhere = ledgerWhere({ ...filters, type: undefined });
  const [total, byType, entries] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ["type"], where: sharedWhere, _sum: { amount: true }, _count: true }),
    prisma.payment.findMany({
      where,
      include: ledgerInclude,
      orderBy: [{ paidAt: "desc" }, { receiptSequence: "desc" }],
      take: filters.limit,
      skip: filters.offset,
    }),
  ]);
  return { total, byType, entries };
}

export function findById(id) {
  return prisma.payment.findUnique({ where: { id }, include: ledgerInclude });
}

// Collected / refunded / reversed / net per calendar month of `year`,
// by the date the money actually moved (paidAt), in Sri Lanka time.
export function findMonthlyTotals(year) {
  return prisma.$queryRaw`
    SELECT
      EXTRACT(MONTH FROM ("paid_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo'))::int AS month,
      COALESCE(SUM(CASE WHEN "type" IN ('FULL', 'PARTIAL', 'TOP_UP') THEN "amount" END), 0) AS collected,
      COALESCE(SUM(CASE WHEN "type" = 'REFUND' THEN -"amount" END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN "type" = 'REVERSAL' THEN -"amount" END), 0) AS reversed,
      COALESCE(SUM("amount"), 0) AS net,
      COUNT(*)::int AS entries
    FROM "payments"
    WHERE EXTRACT(YEAR FROM ("paid_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Colombo')) = ${year}
    GROUP BY 1
    ORDER BY 1`;
}

// Partial payers who still owe the rest of their course: not cancelled,
// paymentStatus PARTIAL. Owed = course price − what they've paid (net of
// any refunds/reversals).
export async function findOutstanding() {
  const enrollments = await prisma.enrollment.findMany({
    where: { paymentStatus: "PARTIAL", status: { not: "CANCELLED" } },
    select: {
      id: true,
      createdAt: true,
      status: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      course: { select: { id: true, title: true, price: true, currency: true, service: { select: { slug: true } } } },
      intake: { select: { id: true, code: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return enrollments;
}

async function lockEnrollment(transaction, enrollmentId) {
  const enrollment = await transaction.enrollment.findUnique({ where: { id: enrollmentId }, select: { intakeId: true, intake: { select: { serviceId: true } } } });
  if (!enrollment) throw new NotFoundError("Enrollment not found.");
  await acquireTransactionLock(transaction, `learning-service:${enrollment.intake.serviceId}`);
  await acquireTransactionLock(transaction, `intake:${enrollment.intakeId}`);
  await acquireTransactionLock(transaction, `enrollment:${enrollmentId}`);
}

function assertCorrectable(original) {
  if (!original) throw new NotFoundError("Payment not found.");
  if (!["FULL", "PARTIAL", "TOP_UP"].includes(original.type)) {
    throw new ConflictError("Refunds and reversals can't themselves be refunded or reversed.", "PAYMENT_NOT_CORRECTABLE");
  }
  if (original.corrections.some((entry) => entry.type === "REVERSAL")) {
    throw new ConflictError("This payment has already been reversed.", "PAYMENT_ALREADY_REVERSED");
  }
}

/** A REFUND: money given back, up to what remains of the original payment. */
export async function createRefund(paymentId, actorId, { amount, reason, method, paidAt }) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.payment.findUnique({ where: { id: paymentId }, select: { enrollmentId: true } });
      if (!initial) throw new NotFoundError("Payment not found.");
      await lockEnrollment(transaction, initial.enrollmentId);
      const original = await transaction.payment.findUnique({ where: { id: paymentId }, include: { corrections: { select: { type: true, amount: true } } } });
      assertCorrectable(original);
      const alreadyRefunded = original.corrections
        .filter((entry) => entry.type === "REFUND")
        .reduce((sum, entry) => sum.plus(new Prisma.Decimal(entry.amount).negated()), new Prisma.Decimal(0));
      const refundable = new Prisma.Decimal(original.amount).minus(alreadyRefunded);
      const refund = new Prisma.Decimal(amount).toDecimalPlaces(2);
      if (refund.greaterThan(refundable)) {
        throw new ConflictError(`At most ${refundable.toFixed(2)} ${original.currency} of this payment can still be refunded.`, "REFUND_EXCEEDS_PAYMENT");
      }
      const created = await transaction.payment.create({
        data: {
          enrollmentId: original.enrollmentId,
          courseId: original.courseId,
          intakeId: original.intakeId,
          type: "REFUND",
          amount: refund.negated(),
          discountAmount: new Prisma.Decimal(0),
          currency: original.currency,
          method: method ?? null,
          note: reason,
          recordedByUserId: actorId,
          paidAt: paidAt ? new Date(paidAt) : new Date(),
          correctsPaymentId: original.id,
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

/**
 * A REVERSAL: cancels an entry recorded by mistake, equal and opposite.
 *  - Reversing a TOP_UP puts the enrollment back to PARTIAL (it was what
 *    completed the payment).
 *  - Reversing the initial FULL/PARTIAL entry is only allowed once the
 *    enrollment is CANCELLED, so no active student is left with nothing paid.
 *  - An entry that has been partly refunded can't be reversed.
 */
export async function createReversal(paymentId, actorId, { reason }) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const initial = await transaction.payment.findUnique({ where: { id: paymentId }, select: { enrollmentId: true } });
      if (!initial) throw new NotFoundError("Payment not found.");
      await lockEnrollment(transaction, initial.enrollmentId);
      const original = await transaction.payment.findUnique({
        where: { id: paymentId },
        include: { corrections: { select: { type: true, amount: true } }, enrollment: { select: { status: true, paymentStatus: true } } },
      });
      assertCorrectable(original);
      if (original.corrections.some((entry) => entry.type === "REFUND")) {
        throw new ConflictError("This payment has refunds recorded against it, so it can't be reversed.", "PAYMENT_HAS_REFUNDS");
      }
      if (original.type !== "TOP_UP" && original.enrollment.status !== "CANCELLED") {
        throw new ConflictError("Cancel the enrollment first — its first payment can only be reversed once the student is no longer enrolled.", "ENROLLMENT_NOT_CANCELLED");
      }
      const created = await transaction.payment.create({
        data: {
          enrollmentId: original.enrollmentId,
          courseId: original.courseId,
          intakeId: original.intakeId,
          type: "REVERSAL",
          amount: new Prisma.Decimal(original.amount).negated(),
          discountAmount: new Prisma.Decimal(0),
          currency: original.currency,
          method: original.method,
          note: reason,
          recordedByUserId: actorId,
          correctsPaymentId: original.id,
        },
        select: { id: true },
      });
      if (original.type === "TOP_UP" && original.enrollment.paymentStatus === "COMPLETED") {
        await transaction.enrollment.update({ where: { id: original.enrollmentId }, data: { paymentStatus: "PARTIAL", paymentCompletedAt: null } });
      }
      return created.id;
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function updateDetails(paymentId, data) {
  try {
    return await prisma.payment.update({ where: { id: paymentId }, data, select: { id: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}
