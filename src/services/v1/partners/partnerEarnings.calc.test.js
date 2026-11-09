import { describe, expect, it } from "vitest";
import { allocate, computeByIntake, computeOverview, shareSetFor, toCents } from "./partnerEarnings.calc.js";

const A = "partner-a";
const M = "partner-m";
const P = "partner-p";
const partners = [
  { id: A, name: "Anushka", displayOrder: 1 },
  { id: M, name: "Methmal", displayOrder: 2 },
  { id: P, name: "Pasindu", displayOrder: 3 },
];
const order = new Map(partners.map((partner) => [partner.id, partner.displayOrder]));
const founding = { effectiveFrom: "2020-01-01T00:00:00.000Z", entries: [{ partnerId: A, percent: 37.5 }, { partnerId: M, percent: 37.5 }, { partnerId: P, percent: 25 }] };
const later = { effectiveFrom: "2026-07-01T00:00:00.000Z", entries: [{ partnerId: A, percent: 50 }, { partnerId: M, percent: 30 }, { partnerId: P, percent: 20 }] };
const sum = (map) => [...map.values()].reduce((total, part) => total + part, 0);

describe("allocate", () => {
  it("always adds up to exactly the amount, positive or negative", () => {
    for (const cents of [1, 2, 3, 7, 99, 100, 101, 333, 1001, 999_999, 1_234_567, -1, -101, -333_333]) {
      expect(sum(allocate(cents, founding.entries, order))).toBe(cents);
    }
  });

  it("splits by the percentages", () => {
    expect(Object.fromEntries(allocate(900_000, founding.entries, order))).toEqual({ [A]: 337_500, [M]: 337_500, [P]: 225_000 });
  });

  it("gives leftover cents to the largest share, ties broken by display order", () => {
    // 1 cent: 37.5% each for A and M floors to 0; A wins the tie.
    expect(Object.fromEntries(allocate(1, founding.entries, order))).toEqual({ [A]: 1, [M]: 0, [P]: 0 });
  });

  it("mirrors a reversal exactly, so a net-zero pair nets zero per partner", () => {
    const plus = allocate(1_001, founding.entries, order);
    const minus = allocate(-1_001, founding.entries, order);
    for (const id of [A, M, P]) expect(plus.get(id) + minus.get(id)).toBe(0);
  });
});

describe("shareSetFor", () => {
  it("uses the split in effect on the row's own date", () => {
    expect(shareSetFor([founding, later], "2026-03-01T00:00:00.000Z")).toBe(founding);
    expect(shareSetFor([founding, later], "2026-07-01T00:00:00.000Z")).toBe(later);
  });
});

describe("computeOverview", () => {
  it("stays balanced: everyone's owed adds up to cash on hand", () => {
    const result = computeOverview({
      partners,
      shareSets: [founding],
      payments: [{ amount: 9000, paidAt: "2026-09-01T00:00:00.000Z" }],
      expenses: [
        { amount: 1000, spentAt: "2026-09-02T00:00:00.000Z", paidByPartnerId: null },
        { amount: 300, spentAt: "2026-09-03T00:00:00.000Z", paidByPartnerId: M },
      ],
      payouts: [{ amount: 500, partnerId: A }],
    });
    expect(result.totals).toMatchObject({ revenue: 9000, expenses: 1300, profit: 7700, paidOut: 500, cashOnHand: 7500, balanced: true });
    const methmal = result.partners.find((row) => row.partnerId === M);
    // 37.5% of revenue − 37.5% of expenses + the 300 they paid themselves.
    expect(methmal.earned).toBe(3375 - 487.5 + 300);
  });

  it("nets a payment and its reversal to zero for every partner, even across a split change (M03-04)", () => {
    // The reversal carries the original's date, so both rows use the same split.
    const result = computeOverview({
      partners,
      shareSets: [founding, later],
      payments: [
        { amount: 10000, paidAt: "2026-03-01T00:00:00.000Z" },
        { amount: -10000, paidAt: "2026-03-01T00:00:00.000Z" },
      ],
      expenses: [],
      payouts: [],
    });
    for (const row of result.partners) expect(row.owed).toBe(0);
    expect(result.totals.balanced).toBe(true);
  });
});

describe("computeByIntake", () => {
  it("splits each intake's profit and keeps general expenses in their own row", () => {
    const rows = computeByIntake({
      partners,
      shareSets: [founding],
      payments: [{ amount: 4000, intakeId: "i-1", paidAt: "2026-09-01T00:00:00.000Z" }],
      expenses: [
        { amount: 400, intakeId: "i-1", spentAt: "2026-09-01T00:00:00.000Z" },
        { amount: 100, intakeId: null, spentAt: "2026-09-01T00:00:00.000Z" },
      ],
      intakes: new Map([["i-1", { intakeCode: "AI-ML-2026-1", courseTitle: "AI-ML" }]]),
    });
    expect(rows[0]).toMatchObject({ intakeId: "i-1", revenue: 4000, expenses: 400, profit: 3600 });
    expect(rows[0].shares.reduce((total, share) => total + toCents(share.amount), 0)).toBe(toCents(3600));
    expect(rows.at(-1)).toMatchObject({ intakeId: null, courseTitle: "General expenses", profit: -100 });
  });
});
