import { z } from "zod";
import { PAYMENT_METHODS } from "../enrollments/enrollment.schema.js";
import { endOfColomboDay } from "../../../utils/colomboTime.js";

export const EXPENSE_CATEGORIES = Object.freeze(["ADVERTISING", "INSTRUCTOR_FEES", "SOFTWARE_HOSTING", "VENUE", "EQUIPMENT", "TRANSPORT", "OTHER"]);

const dateString = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.");
// "Not in the future" means not after today in Sri Lanka. Any time on
// today's Colombo date is fine, so a date picked as "today" (which the
// client may stamp at any hour) is never refused (code review M03-02/13).
const notInFuture = (label) =>
  dateString.refine((value) => new Date(value).getTime() <= endOfColomboDay().getTime(), `${label} can't be in the future.`);
const money = (label) =>
  z.coerce.number({ error: `Enter the ${label}.` }).positive(`Enter the ${label}.`).max(99_999_999, "That amount is too large.");

export const rangeQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

export const createExpenseSchema = z
  .object({
    spentAt: notInFuture("The expense date"),
    amount: money("amount"),
    category: z.enum(EXPENSE_CATEGORIES, { error: "Choose a category." }),
    description: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional(),
    intakeId: z.string().uuid().nullable().optional(),
    paidByPartnerId: z.string().uuid().nullable().optional(),
    receiptObjectId: z.string().uuid().nullable().optional(),
  })
  .strict("Only documented expense fields are accepted.")
  // "Other" must say what the expense was (decided 2026-10-01).
  .refine((data) => data.category !== "OTHER" || (data.description && data.description.length >= 3), {
    message: "Describe what this expense was.",
    path: ["description"],
  });

export const expenseFiltersSchema = rangeQuerySchema.extend({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  intakeId: z.union([z.string().uuid(), z.literal("GENERAL")]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createPayoutSchema = z
  .object({
    partnerId: z.string({ error: "Choose the partner." }).uuid("Choose the partner."),
    amount: money("amount paid out"),
    paidAt: notInFuture("The payout date"),
    method: z.enum(PAYMENT_METHODS).nullable().optional(),
    reference: z.string().trim().max(160).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict("Only documented payout fields are accepted.");

export const payoutFiltersSchema = rangeQuerySchema.extend({
  partnerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const reverseEntrySchema = z
  .object({
    reason: z.string({ error: "Say why this entry was a mistake." }).trim().min(3, "Say why this entry was a mistake.").max(500),
  })
  .strict("Only documented fields are accepted.");

export const createShareSetSchema = z
  .object({
    effectiveFrom: dateString,
    note: z.string().trim().max(200).nullable().optional(),
    entries: z
      .array(
        z.object({
          partnerId: z.string().uuid(),
          // Stored as Decimal(5,2): more decimals would be rounded away after
          // the 100% check passed (code review M03-15).
          percent: z.coerce
            .number()
            .min(0)
            .max(100)
            .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, "Use at most 2 decimal places."),
        }),
      )
      .min(1),
  })
  .strict("Only documented share fields are accepted.")
  .refine((data) => Math.round(data.entries.reduce((sum, entry) => sum + entry.percent * 100, 0)) === 10000, {
    message: "The shares must add up to exactly 100%.",
    path: ["entries"],
  });
