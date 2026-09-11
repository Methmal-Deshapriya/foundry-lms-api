import { afterEach, describe, expect, it } from "vitest";
import { hashOtp, hashOtpCandidates } from "./otp.js";

const originalKeys = process.env.OTP_HMAC_KEYS;

afterEach(() => {
  if (originalKeys === undefined) delete process.env.OTP_HMAC_KEYS;
  else process.env.OTP_HMAC_KEYS = originalKeys;
});

describe("short-code HMAC storage", () => {
  it("does not produce the enumerable plain SHA-256 value", async () => {
    process.env.OTP_HMAC_KEYS =
      "v2:current-secret-with-at-least-thirty-two-bytes";
    const digest = hashOtp("123456");
    expect(digest).toMatch(/^v2:[a-f0-9]{64}$/);
    expect(digest).not.toBe(
      "8d969eef6ecad3c29a3a629280e686cff8ca" +
        "a48c47a1bdbccf99e33a0aaf",
    );
  });

  it("verifies current and retained rotation keys", () => {
    process.env.OTP_HMAC_KEYS = [
      "v2:current-secret-with-at-least-thirty-two-bytes",
      "v1:previous-secret-with-at-least-thirty-two-bytes",
    ].join(",");
    expect(hashOtpCandidates("654321")).toHaveLength(2);
    expect(hashOtpCandidates("654321").map((hash) => hash.split(":")[0]))
      .toEqual(["v2", "v1"]);
  });
});
