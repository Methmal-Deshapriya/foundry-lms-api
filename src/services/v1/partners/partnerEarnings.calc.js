/**
 * Partner earnings — the pure calculation engine (no database access), so
 * the money logic can be checked in isolation. All arithmetic is in integer
 * cents. See foundry_lms_docs/2026-10-01_partner_earnings_implementation_plan.md §2.
 *
 * Inputs (amounts as numbers in LKR; REFUND/REVERSAL rows already negative):
 *   partners   [{ id, name, displayOrder }]
 *   shareSets  [{ effectiveFrom: Date, entries: [{ partnerId, percent }] }]
 *   payments   [{ amount, paidAt, intakeId }]
 *   expenses   [{ amount, spentAt, intakeId|null, paidByPartnerId|null }]
 *   payouts    [{ amount, paidAt, partnerId }]
 */

export const toCents = (amount) => Math.round(Number(amount) * 100);
export const fromCents = (cents) => cents / 100;

/** The share set in effect on `date`: the latest one starting on or before it (the earliest set if none has started yet). */
export function shareSetFor(shareSets, date) {
  const time = new Date(date).getTime();
  let chosen = shareSets[0];
  for (const set of shareSets) {
    if (new Date(set.effectiveFrom).getTime() <= time) chosen = set;
  }
  return chosen;
}

/**
 * Splits `cents` by `entries` percentages. Each partner gets the floor of
 * their exact share; the leftover cents (from rounding) go to the partner
 * with the largest share, ties broken by display order — so the parts always
 * add up to exactly `cents`.
 */
export function allocate(cents, entries, partnerOrder) {
  const result = new Map();
  if (!entries?.length) return result;
  const sign = cents < 0 ? -1 : 1;
  const absolute = Math.abs(cents);
  let assigned = 0;
  for (const entry of entries) {
    const part = Math.floor((absolute * Math.round(Number(entry.percent) * 100)) / 10000);
    result.set(entry.partnerId, part);
    assigned += part;
  }
  const leftover = absolute - assigned;
  if (leftover !== 0) {
    const recipient = [...entries].sort(
      (a, b) => Number(b.percent) - Number(a.percent) || (partnerOrder.get(a.partnerId) ?? 0) - (partnerOrder.get(b.partnerId) ?? 0),
    )[0];
    result.set(recipient.partnerId, result.get(recipient.partnerId) + leftover);
  }
  for (const [partnerId, part] of result) result.set(partnerId, part * sign);
  return result;
}

function emptyTotals(partners) {
  return new Map(partners.map((partner) => [partner.id, { revenue: 0, expenses: 0, reimbursed: 0, paidOut: 0 }]));
}

/**
 * Per-partner totals for the given rows (callers pre-filter by date range).
 *   earned = share of revenue − share of expenses + out-of-pocket expenses they paid
 *   owed   = earned − paid out
 * Plus the cash-on-hand check: revenue − business-paid expenses − payouts,
 * which must equal the sum of everyone's `owed`.
 */
export function computeOverview({ partners, shareSets, payments, expenses, payouts }) {
  const order = new Map(partners.map((partner) => [partner.id, partner.displayOrder]));
  const totals = emptyTotals(partners);
  let revenueCents = 0;
  let expenseCents = 0;
  let businessExpenseCents = 0;
  let payoutCents = 0;

  for (const payment of payments) {
    const cents = toCents(payment.amount);
    revenueCents += cents;
    for (const [partnerId, part] of allocate(cents, shareSetFor(shareSets, payment.paidAt)?.entries, order)) {
      if (totals.has(partnerId)) totals.get(partnerId).revenue += part;
    }
  }
  for (const expense of expenses) {
    const cents = toCents(expense.amount);
    expenseCents += cents;
    if (!expense.paidByPartnerId) businessExpenseCents += cents;
    for (const [partnerId, part] of allocate(cents, shareSetFor(shareSets, expense.spentAt)?.entries, order)) {
      if (totals.has(partnerId)) totals.get(partnerId).expenses += part;
    }
    // A partner who paid out of pocket is owed the full amount back.
    if (expense.paidByPartnerId && totals.has(expense.paidByPartnerId)) totals.get(expense.paidByPartnerId).reimbursed += cents;
  }
  for (const payout of payouts) {
    const cents = toCents(payout.amount);
    payoutCents += cents;
    if (totals.has(payout.partnerId)) totals.get(payout.partnerId).paidOut += cents;
  }

  const rows = partners.map((partner) => {
    const t = totals.get(partner.id);
    const earned = t.revenue - t.expenses + t.reimbursed;
    return {
      partnerId: partner.id,
      name: partner.name,
      revenueShare: fromCents(t.revenue),
      expenseShare: fromCents(t.expenses),
      reimbursed: fromCents(t.reimbursed),
      earned: fromCents(earned),
      paidOut: fromCents(t.paidOut),
      owed: fromCents(earned - t.paidOut),
    };
  });
  const cashOnHand = revenueCents - businessExpenseCents - payoutCents;
  const owedTotal = rows.reduce((sum, row) => sum + toCents(row.owed), 0);
  return {
    partners: rows,
    totals: {
      revenue: fromCents(revenueCents),
      expenses: fromCents(expenseCents),
      profit: fromCents(revenueCents - expenseCents),
      paidOut: fromCents(payoutCents),
      cashOnHand: fromCents(cashOnHand),
      // Should always be true; false means the data or the maths is off.
      balanced: owedTotal === cashOnHand,
    },
  };
}

/**
 * Per-intake profit and each partner's share of it, plus a "General" row for
 * expenses not tied to an intake. `intakes` maps intakeId → label info.
 */
export function computeByIntake({ partners, shareSets, payments, expenses, intakes }) {
  const order = new Map(partners.map((partner) => [partner.id, partner.displayOrder]));
  const rows = new Map();
  const rowFor = (intakeId) => {
    const key = intakeId ?? "GENERAL";
    if (!rows.has(key)) {
      rows.set(key, { intakeId: intakeId ?? null, revenue: 0, expenses: 0, shares: new Map(partners.map((partner) => [partner.id, 0])) });
    }
    return rows.get(key);
  };

  for (const payment of payments) {
    const cents = toCents(payment.amount);
    const row = rowFor(payment.intakeId);
    row.revenue += cents;
    for (const [partnerId, part] of allocate(cents, shareSetFor(shareSets, payment.paidAt)?.entries, order)) {
      if (row.shares.has(partnerId)) row.shares.set(partnerId, row.shares.get(partnerId) + part);
    }
  }
  for (const expense of expenses) {
    const cents = toCents(expense.amount);
    const row = rowFor(expense.intakeId);
    row.expenses += cents;
    for (const [partnerId, part] of allocate(cents, shareSetFor(shareSets, expense.spentAt)?.entries, order)) {
      if (row.shares.has(partnerId)) row.shares.set(partnerId, row.shares.get(partnerId) - part);
    }
  }

  return [...rows.values()]
    .map((row) => ({
      intakeId: row.intakeId,
      ...(row.intakeId ? intakes.get(row.intakeId) ?? { intakeCode: "Unknown intake", courseTitle: "" } : { intakeCode: null, courseTitle: "General expenses" }),
      revenue: fromCents(row.revenue),
      expenses: fromCents(row.expenses),
      profit: fromCents(row.revenue - row.expenses),
      shares: partners.map((partner) => ({ partnerId: partner.id, amount: fromCents(row.shares.get(partner.id)) })),
    }))
    .sort((a, b) => (a.intakeId === null) - (b.intakeId === null) || b.revenue - a.revenue);
}
