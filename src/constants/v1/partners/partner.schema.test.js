import { describe, expect, it } from "vitest";
import { createExpenseSchema, createShareSetSchema } from "./partner.schema.js";
import { refundPaymentSchema } from "../payments/payment.schema.js";
import { endOfColomboDay, startOfColomboDay } from "../../../utils/colomboTime.js";

const entries = (a, b, c) => [
  { partnerId: "10000000-0000-4000-8000-000000000001", percent: a },
  { partnerId: "10000000-0000-4000-8000-000000000002", percent: b },
  { partnerId: "10000000-0000-4000-8000-000000000003", percent: c },
];

describe("money input rules", () => {
  it("accepts an expense stamped any time today in Sri Lanka, refuses tomorrow (M03-02)", () => {
    const base = { amount: 100, category: "ADVERTISING" };
    expect(createExpenseSchema.safeParse({ ...base, spentAt: endOfColomboDay().toISOString() }).success).toBe(true);
    const tomorrow = new Date(endOfColomboDay().getTime() + 60_000).toISOString();
    expect(createExpenseSchema.safeParse({ ...base, spentAt: tomorrow }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, spentAt: startOfColomboDay().toISOString() }).success).toBe(true);
  });

  it("refuses split percentages with more than 2 decimals (M03-15)", () => {
    expect(createShareSetSchema.safeParse({ effectiveFrom: "2030-01-01", entries: entries(33.333, 33.333, 33.334) }).success).toBe(false);
    expect(createShareSetSchema.safeParse({ effectiveFrom: "2030-01-01", entries: entries(37.5, 37.5, 25) }).success).toBe(true);
  });

  it("refuses a sub-cent refund (M03-14)", () => {
    expect(refundPaymentSchema.safeParse({ amount: 0.004, reason: "Typo test" }).success).toBe(false);
    expect(refundPaymentSchema.safeParse({ amount: 10.505, reason: "Typo test" }).success).toBe(false);
    expect(refundPaymentSchema.safeParse({ amount: 0.01, reason: "Smallest" }).success).toBe(true);
  });
});
