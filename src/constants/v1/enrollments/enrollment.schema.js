import { z } from "zod";
import {
  ALL_ENROLLMENT_STATUSES,
  PAYMENT_STATUS,
} from "./enrollment.constants.js";

// An admin only ever records an enrollment after the student has already
// paid something — either the full (discounted) price or half of it — so
// PENDING isn't a selectable outcome here.
const paidPaymentStatuses = [PAYMENT_STATUS.PARTIAL, PAYMENT_STATUS.COMPLETED];

export const manualEnrollmentSchema = z.object({
  userId: z.string().uuid("Invalid user ID."),
  paymentStatus: z.enum(paidPaymentStatuses).default(PAYMENT_STATUS.COMPLETED),
  externalPaymentReference: z.string().trim().max(160).nullable().optional(),
  paymentNote: z.string().trim().max(1000).nullable().optional(),
});

export const bulkManualEnrollmentSchema = z
  .object({
    students: z.array(manualEnrollmentSchema).min(1).max(100),
  })
  .superRefine(({ students }, context) => {
    const seen = new Set();
    students.forEach(({ userId }, index) => {
      if (seen.has(userId)) {
        context.addIssue({
          code: "custom",
          message: "Each student can appear only once in a bulk request.",
          path: ["students", index, "userId"],
        });
      }
      seen.add(userId);
    });
  });

// paymentStatus is intentionally not editable here — it only ever changes
// via the ledger-aware paths (enrollment creation, or POST
// /enrollments/:id/complete-payment), so every change stays backed by a
// Payment row. A generic PATCH that flipped the status directly would let
// paymentStatus and the payment ledger disagree.
export const updateEnrollmentSchema = z
  .object({
    status: z.enum(ALL_ENROLLMENT_STATUSES).optional(),
    externalPaymentReference: z.string().trim().max(160).nullable().optional(),
    paymentNote: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required.",
  });

export const eligibleStudentFiltersSchema = z.object({
  q: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().trim().min(1).max(512).optional(),
});

export const eligibleStudentCursorPayloadSchema = z.object({
  intakeId: z.string().uuid(),
  q: z.string().max(100),
  email: z.string().email().max(320),
  id: z.string().uuid(),
});

// Offset-paginated (not cursor) — this roster is only ever scoped to one
// course at a time, a bounded list, so a real "page N of M" / total count
// works fine and matches the admin table pattern used everywhere else
// (Session Library, and this same course workspace's other tabs).
export const enrollmentRosterFiltersSchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(ALL_ENROLLMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
