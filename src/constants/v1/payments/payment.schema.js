import { z } from "zod";
import { PAYMENT_METHODS } from "../enrollments/enrollment.schema.js";

export const PAYMENT_TYPES = Object.freeze(["FULL", "PARTIAL", "TOP_UP", "REFUND", "REVERSAL"]);
// Entries that represent money coming in — the only kinds that can be refunded or reversed.
export const INCOMING_PAYMENT_TYPES = Object.freeze(["FULL", "PARTIAL", "TOP_UP"]);

const dateString = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.");

const notInFuture = (label) =>
  dateString.refine((value) => new Date(value).getTime() <= Date.now() + 5 * 60_000, `${label} can't be in the future.`);

export const paymentLedgerFiltersSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  serviceId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  intakeId: z.string().uuid().optional(),
  method: z.enum([...PAYMENT_METHODS, "NONE"]).optional(),
  type: z.enum(PAYMENT_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const monthlySummaryQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
});

export const refundPaymentSchema = z
  .object({
    amount: z.coerce.number({ error: "Enter the amount refunded." }).positive("Enter the amount refunded.").max(99_999_999),
    reason: z.string({ error: "Say why the money was refunded." }).trim().min(3, "Say why the money was refunded.").max(500),
    method: z.enum(PAYMENT_METHODS).nullable().optional(),
    paidAt: notInFuture("The refund date").optional(),
  })
  .strict("Only documented refund fields are accepted.");

export const reversePaymentSchema = z
  .object({
    reason: z.string({ error: "Say why this entry was a mistake." }).trim().min(3, "Say why this entry was a mistake.").max(500),
  })
  .strict("Only documented reversal fields are accepted.");

// The descriptive details an admin may complete after the fact. The money
// itself (amount, type, discount, enrollment) is never editable.
export const updatePaymentDetailsSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS).nullable().optional(),
    paidAt: notInFuture("The payment date").optional(),
    externalReference: z.string().trim().max(160).nullable().optional(),
    proofObjectId: z.string().uuid().nullable().optional(),
  })
  .strict("Only documented payment detail fields are accepted.")
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");
