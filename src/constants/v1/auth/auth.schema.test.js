import { describe, expect, it } from "vitest";
import { updateProfileSchema } from "./auth.schema.js";

describe("profile bounds", () => {
  it("uses one real-calendar YYYY-MM-DD contract", () => {
    expect(updateProfileSchema.safeParse({ dateOfBirth: "2000-02-29" }).success)
      .toBe(true);
    expect(updateProfileSchema.safeParse({ dateOfBirth: "2001-02-29" }).success)
      .toBe(false);
    expect(updateProfileSchema.safeParse({ dateOfBirth: "2000-01-01T00:00:00Z" }).success)
      .toBe(false);
  });

  it("rejects unbounded and empty profile updates", () => {
    expect(updateProfileSchema.safeParse({ firstName: "x".repeat(81) }).success)
      .toBe(false);
    expect(updateProfileSchema.safeParse({ address: "x".repeat(301) }).success)
      .toBe(false);
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });
});
