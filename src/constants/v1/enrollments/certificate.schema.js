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

export const certificateAdminFiltersSchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["ISSUED", "REVOKED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(1024).optional(),
});

export const certificateAdminCursorSchema = z.object({
  q: z.string().max(100),
  status: z.enum(["ISSUED", "REVOKED"]).nullable(),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});
