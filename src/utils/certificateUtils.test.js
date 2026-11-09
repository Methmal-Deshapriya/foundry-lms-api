import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCertificateCode } from "./certificateUtils.js";

describe("generateCertificateCode", () => {
  it("uses a dated prefix and 128 bits of random hex", () => {
    expect(generateCertificateCode()).toMatch(/^FND-\d{8}-[A-F0-9]{32}$/);
  });

  afterEach(() => vi.useRealTimers());

  it("dates the code by the Sri Lanka calendar day (M08-12)", () => {
    // 20:00 UTC on 1 Oct is already 01:30 on 2 Oct in Colombo.
    vi.useFakeTimers({ now: new Date("2026-10-01T20:00:00Z") });
    expect(generateCertificateCode()).toMatch(/^FND-20261002-/);
  });

  it("does not repeat across a practical sample", () => {
    const codes = new Set(Array.from({ length: 1_000 }, generateCertificateCode));
    expect(codes.size).toBe(1_000);
  });
});
