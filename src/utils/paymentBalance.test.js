import { describe, expect, it } from "vitest";
import { paymentBalance } from "./paymentBalance.js";
import { colomboDateString, colomboYear, endOfColomboDay, startOfColomboDay } from "./colomboTime.js";

const row = (id, type, amount, extra = {}) => ({ id, type, amount, discountAmount: 0, correctsPaymentId: null, ...extra });
const owed = (enrollment) => Number(paymentBalance(enrollment).owed);

describe("paymentBalance", () => {
  it("uses the agreed price, not the course's current price (M03-01)", () => {
    expect(owed({ agreedPrice: 30000, course: { price: 40000 }, payments: [row("p", "PARTIAL", 15000)] })).toBe(15000);
  });

  it("is settled after a full payment with its discount", () => {
    expect(owed({ agreedPrice: 30000, payments: [row("f", "FULL", 27000, { discountAmount: 3000 })] })).toBe(0);
  });

  it("owes the whole price again once the full payment is reversed (M03-08)", () => {
    const enrollment = {
      agreedPrice: 30000,
      payments: [row("f", "FULL", 27000, { discountAmount: 3000 }), row("r", "REVERSAL", -27000, { correctsPaymentId: "f" })],
    };
    expect(owed(enrollment)).toBe(30000);
  });

  it("counts refunds as money returned", () => {
    expect(owed({ agreedPrice: 30000, payments: [row("p", "PARTIAL", 15000), row("x", "REFUND", -5000, { correctsPaymentId: "p" })] })).toBe(20000);
  });

  it("falls back to the course price for rows written before agreedPrice existed", () => {
    expect(owed({ agreedPrice: null, course: { price: 10000 }, payments: [row("p", "PARTIAL", 5000)] })).toBe(5000);
  });

  it("never goes negative", () => {
    expect(owed({ agreedPrice: 1000, payments: [row("p", "FULL", 1000), row("t", "TOP_UP", 500)] })).toBe(0);
  });
});

describe("Sri Lanka calendar helpers", () => {
  it("puts 02:00 Colombo on 1 Jan into the new year, though it is still 31 Dec in UTC (M03-12)", () => {
    const instant = "2026-12-31T20:30:00.000Z"; // 02:00 on 1 Jan 2027 in Colombo
    expect(colomboDateString(instant)).toBe("2027-01-01");
    expect(colomboYear(instant)).toBe(2027);
  });

  it("finds the Colombo day's first and last instant", () => {
    const instant = "2026-10-01T03:00:00.000Z"; // 08:30 Colombo, 1 Oct
    expect(startOfColomboDay(instant).toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(endOfColomboDay(instant).toISOString()).toBe("2026-10-01T18:29:59.999Z");
  });
});
