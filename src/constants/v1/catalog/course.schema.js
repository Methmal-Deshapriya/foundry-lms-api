import { z } from "zod";
import {
  COURSE_LEVELS,
  COURSE_ENROLLMENT_STATUSES,
  DURATION_UNITS,
} from "./catalog.constants.js";
import { nullableSecureHttpUrlSchema } from "../shared/url.schema.js";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE_PREFIX_REGEX = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const optionalStringArray = z.array(z.string().trim().min(1).max(160)).max(30).optional();

// The real-world program a student browses and enrolls in — see the
// 2026-08-30 course-to-program-intake rename plan. Every field here is
// content that's identical across every Intake of this course, which is
// exactly why it lives here and not on Intake.
const courseObject = z.object({
  categoryId: z.string().uuid(),
  slug: z.string().trim().min(2).max(100).regex(SLUG_REGEX),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(10).max(300),
  description: z.string().trim().min(20).max(5000),
  level: z.enum(COURSE_LEVELS),
  durationValue: z.number().int().min(1).max(999).nullable().optional(),
  durationUnit: z.enum(DURATION_UNITS).nullable().optional(),
  price: z.number().min(0).max(99999999),
  highlights: optionalStringArray,
  skills: optionalStringArray,
  prerequisites: optionalStringArray,
  thumbnailUrl: nullableSecureHttpUrlSchema,
  sortOrder: z.number().int().min(0).optional(),
  intakeCodePrefix: z.string().trim().min(2).max(80).regex(CODE_PREFIX_REGEX),
  certificateEnabled: z.boolean({
    error: "Select whether this course issues certificates.",
  }),
  // Flat discount for paying an intake's full price in one go, applied to
  // every intake under this course. Irrelevant for FREE services — leave at
  // the default 0 there. Zero by default so it's optional to set.
  discountAmount: z.coerce.number().min(0).default(0),
});

function validateDurationConsistency(data, context) {
  if ((data.durationValue == null) !== (data.durationUnit == null)) {
    context.addIssue({
      code: "custom",
      message: "Duration value and unit must be provided together.",
      path: ["durationValue"],
    });
  }
}

export const createCourseSchema = courseObject
  .strict("Only documented course fields are accepted.")
  .superRefine(validateDurationConsistency);

export const updateCourseSchema = courseObject
  .omit({ categoryId: true, intakeCodePrefix: true, certificateEnabled: true, discountAmount: true })
  .partial()
  .strict("Certificate policy, discount amount, intake code prefix, and parent category cannot be changed after course creation.")
  .superRefine(validateDurationConsistency)
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const courseAdminFiltersSchema = z.object({
  categoryId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  enrollmentStatus: z.enum(COURSE_ENROLLMENT_STATUSES).optional(),
  includeArchived: z.coerce.boolean().default(false),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
