import { z } from "zod";

/**
 * Certificate Schemas
 */

export const issueCertificateSchema = z.object({
  description: z.string().optional().nullable(),
  issuedDate: z.string().datetime("Invalid date format. Expected ISO string.").optional(),
});

export const revokeCertificateSchema = z.object({
  revocationReason: z.string().min(5, "Reason must be at least 5 characters long"),
});
