import { describe, expect, it } from "vitest";
import { secureHttpUrlSchema } from "./url.schema.js";

describe("secure HTTP URL validation", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "http://tracking.example/image.png",
  ])("rejects unsafe or insecure URL %s", (value) => {
    expect(secureHttpUrlSchema.safeParse(value).success).toBe(false);
  });

  it("allows HTTPS and local-development HTTP", () => {
    expect(
      secureHttpUrlSchema.safeParse("https://drive.google.com/recording").success,
    ).toBe(true);
    expect(
      secureHttpUrlSchema.safeParse("http://localhost:3000/resource").success,
    ).toBe(true);
  });
});
