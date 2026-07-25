import crypto from "crypto";

/**
 * Reset Token Utility - The "One-Time Key Cutter"
 * Generates password-reset tokens. Only the hash is ever stored;
 * the raw token is emailed to the user and never persisted anywhere.
 */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generate a new password reset token.
 * @returns {{ rawToken: string, tokenHash: string, expiresAt: Date }}
 */
export const generateResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  return { rawToken, tokenHash, expiresAt };
};

/**
 * Hash a raw reset token so it can be looked up/stored without ever
 * persisting the value that was actually emailed to the user.
 * @param {string} rawToken
 * @returns {string}
 */
export const hashResetToken = (rawToken) => {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
};
