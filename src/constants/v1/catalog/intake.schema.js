import { z } from "zod";
import { INTAKE_STATUSES } from "./catalog.constants.js";

// One scheduled, enrollable run of a Course. Per the 2026-08-30 rename plan
// §3a, nearly everything about an intake is inherited from its Course or
// auto-suggested — this is deliberately a much smaller payload than the old
// per-intake course-creation schema it replaces.
const intakeObject = z.object({
  intakeKey: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z]+(?:-[0-9A-Za-z]+)*$/).optional(),
  startDate: z.coerce.date().nullable().optional(),
  expectedEndDate: z.coerce.date().nullable().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
});

function validateDatesConsistency(data, context) {
  if ((data.startDate == null) !== (data.expectedEndDate == null)) {
    context.addIssue({
      code: "custom",
      message: "Start and expected end dates must be provided together.",
      path: ["startDate"],
    });
  }
  if (data.startDate && data.expectedEndDate && data.expectedEndDate <= data.startDate) {
    context.addIssue({
      code: "custom",
      message: "Expected end date must be after the start date.",
      path: ["expectedEndDate"],
    });
  }
}

export const createIntakeSchema = intakeObject
  .strict("Only documented intake fields are accepted. Everything else is inherited from the course.")
  .superRefine(validateDatesConsistency);

export const updateIntakeSchema = intakeObject
  .pick({ startDate: true, expectedEndDate: true, timezone: true, capacity: true })
  .partial()
  .strict("Only dates, timezone, and capacity can be changed after intake creation.")
  .superRefine(validateDatesConsistency)
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const intakeStatusSchema = z.object({
  status: z.enum(INTAKE_STATUSES),
  expectedStatus: z.enum(INTAKE_STATUSES),
});

export const intakeAdminFiltersSchema = z.object({
  serviceId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  status: z.enum(INTAKE_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
