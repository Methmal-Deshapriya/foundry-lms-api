import { z } from "zod";

export const BATCH_STATUSES = Object.freeze([
  "DRAFT",
  "ENROLLING",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
]);

const batchCode = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "Use uppercase letters, numbers, and hyphens.");

const batchFields = z.object({
  name: z.string().trim().min(3).max(180),
  code: batchCode,
  startDate: z.coerce.date(),
  expectedEndDate: z.coerce.date(),
  timezone: z.string().trim().min(1).max(100).default("Asia/Colombo"),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
});

function validateDates(data, context) {
  if (data.startDate && data.expectedEndDate && data.expectedEndDate < data.startDate) {
    context.addIssue({
      code: "custom",
      message: "Expected end date cannot be before the start date.",
      path: ["expectedEndDate"],
    });
  }
}

export const createBatchSchema = batchFields
  .extend({ initializeCurriculum: z.boolean().default(true) })
  .superRefine(validateDates);

export const updateBatchSchema = batchFields
  .partial()
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const updateBatchStatusSchema = z.object({
  status: z.enum(BATCH_STATUSES),
});

export const batchFiltersSchema = z.object({
  status: z.enum(BATCH_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const upsertBatchSessionSchema = z.object({
  orderIndex: z.number().int().min(0).max(10000).optional(),
  isReleased: z.boolean().default(false),
  availableAt: z.coerce.date().nullable().optional(),
});

export const reorderBatchSessionsSchema = z.object({
  batchSessions: z
    .array(
      z.object({
        id: z.string().uuid("Invalid batch-session ID."),
        orderIndex: z.number().int().min(0).max(10000),
      }),
    )
    .min(1),
});

