import { Prisma } from "@prisma/client";
import prisma from "../../../utils/prisma.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";

/**
 * Partner earnings repository. Expenses and payouts are append-only.
 */

export const findPartners = () => prisma.partner.findMany({ where: { active: true }, orderBy: { displayOrder: "asc" } });

// For the earnings calculation: every partner who holds a share in any
// split, active or not. A partner leaving later must not make their share
// of past revenue vanish from the totals (code review M03-21).
export const findPartnersForEarnings = () =>
  prisma.partner.findMany({
    where: { OR: [{ active: true }, { shareEntries: { some: {} } }, { payouts: { some: {} } }, { paidExpenses: { some: {} } }] },
    orderBy: { displayOrder: "asc" },
  });

export const findShareSets = () =>
  prisma.shareSet.findMany({
    orderBy: { effectiveFrom: "asc" },
    include: { entries: { include: { partner: { select: { name: true, displayOrder: true } } } }, createdBy: { select: { firstName: true, lastName: true } } },
  });

function dateRange(field, { from, to }) {
  const range = {};
  if (from) range.gte = new Date(from);
  if (to) range.lte = new Date(to);
  return Object.keys(range).length ? { [field]: range } : {};
}

// Raw rows for the calculation engine — only what it needs.
export const findPaymentsForEarnings = (range) =>
  prisma.payment.findMany({ where: dateRange("paidAt", range), select: { amount: true, paidAt: true, intakeId: true } });

export const findExpensesForEarnings = (range) =>
  prisma.expense.findMany({ where: dateRange("spentAt", range), select: { amount: true, spentAt: true, intakeId: true, paidByPartnerId: true } });

export const findPayoutsForEarnings = (range) =>
  prisma.payout.findMany({ where: dateRange("paidAt", range), select: { amount: true, paidAt: true, partnerId: true } });

export const findIntakeLabels = (ids) =>
  prisma.intake.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, course: { select: { title: true } } } });

// ---------------------------------------------------------------- expenses

const expenseInclude = {
  intake: { select: { id: true, code: true, course: { select: { title: true } } } },
  paidBy: { select: { id: true, name: true } },
  recordedBy: { select: { firstName: true, lastName: true } },
  receiptObject: true,
  corrects: { select: { id: true, amount: true, spentAt: true, category: true } },
  corrections: { select: { id: true, amount: true, createdAt: true, description: true } },
};

export async function findExpensesPage({ category, intakeId, limit, offset, ...range }) {
  const where = {
    ...dateRange("spentAt", range),
    ...(category ? { category } : {}),
    ...(intakeId === "GENERAL" ? { intakeId: null } : intakeId ? { intakeId } : {}),
  };
  const [total, sum, rows] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.findMany({ where, include: expenseInclude, orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }], take: limit, skip: offset }),
  ]);
  return { total, sum: Number(sum._sum.amount ?? 0), rows };
}

export const findExpenseById = (id) => prisma.expense.findUnique({ where: { id }, include: expenseInclude });

export async function createExpense(data) {
  try {
    return await prisma.expense.create({ data, select: { id: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function reverseExpense(id, actorId, reason) {
  return prisma.$transaction(async (transaction) => {
    // Serializes reversals of one expense, so a double click or two admins
    // at once can't both pass the "already reversed?" check (M03-03).
    await acquireTransactionLock(transaction, `expense-reversal:${id}`);
    const original = await transaction.expense.findUnique({ where: { id }, include: { corrections: { select: { id: true } } } });
    if (!original) throw new NotFoundError("Expense not found.");
    if (original.kind === "REVERSAL") throw new ConflictError("A reversal can't itself be reversed.", "EXPENSE_NOT_REVERSIBLE");
    if (original.corrections.length > 0) throw new ConflictError("This expense has already been reversed.", "EXPENSE_ALREADY_REVERSED");
    const created = await transaction.expense.create({
      data: {
        spentAt: original.spentAt,
        amount: new Prisma.Decimal(original.amount).negated(),
        currency: original.currency,
        category: original.category,
        description: reason,
        intakeId: original.intakeId,
        paidByPartnerId: original.paidByPartnerId,
        kind: "REVERSAL",
        correctsExpenseId: original.id,
        recordedByUserId: actorId,
      },
      select: { id: true },
    });
    return created.id;
  });
}

// ----------------------------------------------------------------- payouts

const payoutInclude = {
  partner: { select: { id: true, name: true } },
  recordedBy: { select: { firstName: true, lastName: true } },
  corrects: { select: { id: true, amount: true, paidAt: true } },
  corrections: { select: { id: true, amount: true, createdAt: true, note: true } },
};

export async function findPayoutsPage({ partnerId, limit, offset, ...range }) {
  const where = { ...dateRange("paidAt", range), ...(partnerId ? { partnerId } : {}) };
  const [total, rows] = await Promise.all([
    prisma.payout.count({ where }),
    prisma.payout.findMany({ where, include: payoutInclude, orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }], take: limit, skip: offset }),
  ]);
  return { total, rows };
}

export async function createPayout(data) {
  try {
    return await prisma.payout.create({ data, select: { id: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function reversePayout(id, actorId, reason) {
  return prisma.$transaction(async (transaction) => {
    await acquireTransactionLock(transaction, `payout-reversal:${id}`);
    const original = await transaction.payout.findUnique({ where: { id }, include: { corrections: { select: { id: true } } } });
    if (!original) throw new NotFoundError("Payout not found.");
    if (original.kind === "REVERSAL") throw new ConflictError("A reversal can't itself be reversed.", "PAYOUT_NOT_REVERSIBLE");
    if (original.corrections.length > 0) throw new ConflictError("This payout has already been reversed.", "PAYOUT_ALREADY_REVERSED");
    const created = await transaction.payout.create({
      data: {
        partnerId: original.partnerId,
        amount: new Prisma.Decimal(original.amount).negated(),
        currency: original.currency,
        paidAt: original.paidAt,
        method: original.method,
        note: reason,
        kind: "REVERSAL",
        correctsPayoutId: original.id,
        recordedByUserId: actorId,
      },
      select: { id: true },
    });
    return created.id;
  });
}

// ------------------------------------------------------------------ shares

export async function createShareSet({ effectiveFrom, note, entries, createdByUserId }) {
  try {
    return await prisma.$transaction(async (transaction) => {
      // Two splits saved at the same moment can't both pass the
      // "starts after the latest" check (code review M03-05).
      await acquireTransactionLock(transaction, "partner-share-sets");
      const latest = await transaction.shareSet.findFirst({ orderBy: { effectiveFrom: "desc" }, select: { effectiveFrom: true } });
      if (latest && new Date(effectiveFrom) <= latest.effectiveFrom) {
        throw new ConflictError("A new split must start after the latest one.", "SHARE_SET_BACKDATED");
      }
      return transaction.shareSet.create({
        data: { effectiveFrom: new Date(effectiveFrom), note: note ?? null, createdByUserId, entries: { create: entries.map((entry) => ({ partnerId: entry.partnerId, percent: entry.percent })) } },
        select: { id: true },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}
