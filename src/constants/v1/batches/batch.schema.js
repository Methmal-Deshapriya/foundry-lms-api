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

export const createBatchSchema = batchFields.superRefine(validateDates);

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

export const updateBatchSessionDeliverySchema = z
  .object({
    mode: z.enum(["UNRELEASED", "RELEASED", "SCHEDULED"]),
    availableAt: z.coerce.date().nullable().optional(),
    acknowledgeSequenceRisk: z.boolean().default(false),
  })
  .superRefine((data, context) => {
    if (data.mode === "SCHEDULED" && !data.availableAt) {
      context.addIssue({
        code: "custom",
        path: ["availableAt"],
        message: "A scheduled session requires an availability time.",
      });
    }
    if (
      data.mode === "SCHEDULED" &&
      data.availableAt &&
      data.availableAt.getTime() <= Date.now()
    ) {
      context.addIssue({
        code: "custom",
        path: ["availableAt"],
        message: "A scheduled session requires a future availability time.",
      });
    }
    if (data.mode !== "SCHEDULED" && data.availableAt) {
      context.addIssue({
        code: "custom",
        path: ["availableAt"],
        message: "Only a scheduled session can have an availability time.",
      });
    }
  });
