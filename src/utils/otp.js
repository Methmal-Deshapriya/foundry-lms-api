import crypto from "crypto";
import dns from "dns";

/**
 * OTP Utility - The "Verification Code Booth"
 * Generates email-verification codes. Only the hash is ever stored;
 * the raw code is emailed to the user and never persisted anywhere.
 */

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a new 6-digit email verification code.
 * @returns {{ code: string, codeHash: string, expiresAt: Date }}
 */
export const generateOtp = () => {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  return { code, codeHash, expiresAt };
};

function otpHmacKeys() {
  const configured = process.env.OTP_HMAC_KEYS?.trim();
  const entries = configured
    ? configured.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [`dev:${process.env.JWT_SECRET ?? "foundry-development-otp-key-change-me"}`];

  return entries.map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1 || separator === entry.length - 1) {
      throw new Error("OTP_HMAC_KEYS contains an invalid version:secret entry.");
    }
    return { version: entry.slice(0, separator), secret: entry.slice(separator + 1) };
  });
}

/**
 * Hash a raw OTP code so it can be looked up/stored without ever
 * persisting the value that was actually emailed to the user.
 * @param {string} code
 * @returns {string}
 */
export const hashOtp = (code) => {
  const { version, secret } = otpHmacKeys()[0];
  const digest = crypto.createHmac("sha256", secret).update(code).digest("hex");
  return `${version}:${digest}`;
};

export const hashOtpCandidates = (code) =>
  otpHmacKeys().map(({ version, secret }) => {
    const digest = crypto.createHmac("sha256", secret).update(code).digest("hex");
    return `${version}:${digest}`;
  });

/**
 * Check whether a domain has any mail servers configured.
 * Catches typo'd domains (e.g. "gmial.com") that pass format validation
 * but can never actually receive mail.
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
export const hasValidMxRecord = (domain) => {
  return new Promise((resolve) => {
    dns.resolveMx(domain, (error, addresses) => {
      resolve(!error && Array.isArray(addresses) && addresses.length > 0);
    });
  });
};
