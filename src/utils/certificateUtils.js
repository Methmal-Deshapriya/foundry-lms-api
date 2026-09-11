import crypto from "crypto";

/**
 * Generate a unique certificate code.
 * Format: FND-YYYYMMDD-RANDOM. The random part contains 128 bits so public
 * verification codes cannot be feasibly enumerated.
 */
export function generateCertificateCode() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(16).toString("hex").toUpperCase();
  return `FND-${date}-${random}`;
}
