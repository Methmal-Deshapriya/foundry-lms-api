import { z } from "zod";
import {
  ALL_ENROLLMENT_STATUSES,
  PAYMENT_STATUS,
} from "./enrollment.constants.js";

const paidPaymentStatuses = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.PARTIAL,
  PAYMENT_STATUS.COMPLETED,
];

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

export const updateEnrollmentSchema = z
  .object({
    status: z.enum(ALL_ENROLLMENT_STATUSES).optional(),
    paymentStatus: z.enum(paidPaymentStatuses).optional(),
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
  batchId: z.string().uuid(),
  q: z.string().max(100),
  email: z.string().email().max(320),
  id: z.string().uuid(),
});

export const enrollmentRosterFiltersSchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(ALL_ENROLLMENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(1024).optional(),
});

export const enrollmentRosterCursorSchema = z.object({
  scopeType: z.enum(["BATCH", "COURSE"]),
  scopeId: z.string().uuid(),
  q: z.string().max(100),
  status: z.enum(ALL_ENROLLMENT_STATUSES).nullable(),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});
