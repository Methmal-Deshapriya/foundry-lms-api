import { describe, expect, it } from "vitest";
import { auditLogQuerySchema } from "./audit.schema.js";

describe("audit log query validation", () => {
  it("rejects invalid limits, identifiers, and dates", () => {
    expect(auditLogQuerySchema.safeParse({ limit: "1000000" }).success).toBe(false);
    expect(auditLogQuerySchema.safeParse({ actorUserId: "not-a-uuid" }).success)
      .toBe(false);
    expect(auditLogQuerySchema.safeParse({ from: "not-a-date" }).success).toBe(false);
  });

  it("rejects reversed date ranges", () => {
    expect(
      auditLogQuerySchema.safeParse({
        from: "2026-08-15T12:00:00.000Z",
        to: "2026-08-14T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
