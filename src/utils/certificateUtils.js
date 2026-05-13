import crypto from "crypto";

/**
 * Generate a unique certificate code.
 * Format: FND-YYYYMMDD-RANDOM (e.g., FND-20260510-A1B2C3)
 */
export function generateCertificateCode() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FND-${date}-${random}`;
}
