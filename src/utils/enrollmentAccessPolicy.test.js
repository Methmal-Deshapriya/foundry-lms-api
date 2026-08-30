import { describe, expect, it } from "vitest";
import { hasLearningAccess, hasSufficientPayment } from "./enrollmentAccessPolicy.js";

describe("hasSufficientPayment", () => {
  it.each([
    ["COMPLETED", true],
    ["PARTIAL", true],
    ["NOT_REQUIRED", false],
  ])("%s -> %s", (paymentStatus, expected) => {
    expect(hasSufficientPayment(paymentStatus)).toBe(expected);
  });
});

describe("hasLearningAccess", () => {
  const paidPolicy = { accessType: "PAID", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" };
  const freePolicy = { accessType: "FREE", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" };

  it("grants access to a fully paid admin enrollment", () => {
    expect(hasLearningAccess({ source: "ADMIN", paymentStatus: "COMPLETED" }, paidPolicy)).toBe(true);
  });

  it("grants access to a partially paid admin enrollment — the whole reason this is centralized", () => {
    expect(hasLearningAccess({ source: "ADMIN", paymentStatus: "PARTIAL" }, paidPolicy)).toBe(true);
  });

  it("denies access to a paid enrollment with no payment recorded", () => {
    expect(hasLearningAccess({ source: "ADMIN", paymentStatus: "NOT_REQUIRED" }, paidPolicy)).toBe(false);
  });

  it("denies access when source doesn't match the policy's enrollment mode", () => {
    expect(hasLearningAccess({ source: "SELF", paymentStatus: "COMPLETED" }, paidPolicy)).toBe(false);
  });

  it("grants access to a free self-enrollment", () => {
    expect(hasLearningAccess({ source: "SELF", paymentStatus: "NOT_REQUIRED" }, freePolicy)).toBe(true);
  });

  it("denies free access if paymentStatus somehow isn't NOT_REQUIRED", () => {
    expect(hasLearningAccess({ source: "SELF", paymentStatus: "PARTIAL" }, freePolicy)).toBe(false);
  });

  it("denies access when the policy and enrollment source disagree on FREE/SELF", () => {
    expect(hasLearningAccess({ source: "ADMIN", paymentStatus: "NOT_REQUIRED" }, freePolicy)).toBe(false);
  });
});
