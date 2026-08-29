import { describe, expect, it } from "vitest";
import { generateCertificateCode } from "./certificateUtils.js";

describe("generateCertificateCode", () => {
  it("uses a dated prefix and 128 bits of random hex", () => {
    expect(generateCertificateCode()).toMatch(/^FND-\d{8}-[A-F0-9]{32}$/);
  });

  it("does not repeat across a practical sample", () => {
    const codes = new Set(Array.from({ length: 1_000 }, generateCertificateCode));
    expect(codes.size).toBe(1_000);
  });
});
