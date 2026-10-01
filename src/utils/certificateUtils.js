import crypto from "crypto";
import { colomboDateString } from "./colomboTime.js";

/**
 * Generate a unique certificate code.
 * Format: FND-YYYYMMDD-RANDOM. The random part contains 128 bits so public
 * verification codes cannot be feasibly enumerated.
 */
export function generateCertificateCode() {
  // The date part is the Sri Lanka calendar day, like the printed date (M08-12).
  const date = colomboDateString().replace(/-/g, "");
  const random = crypto.randomBytes(16).toString("hex").toUpperCase();
  return `FND-${date}-${random}`;
}
