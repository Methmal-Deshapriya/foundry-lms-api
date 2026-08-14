import { z } from "zod";
import {
  CATALOG_STATUSES,
  COURSE_ACCESS_TYPES,
  COURSE_ENROLLMENT_STATUSES,
  COURSE_LEVELS,
  DURATION_UNITS,
  LEARNING_SERVICE_TYPES,
} from "./catalog.constants.js";
import { nullableSecureHttpUrlSchema } from "../shared/url.schema.js";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const optionalStringArray = z.array(z.string().trim().min(1).max(160)).max(30).optional();

const courseObject = z.object({
  categoryId: z.string().uuid(),
  slug: z.string().min(2).max(100).regex(SLUG_REGEX),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(10).max(300),
  description: z.string().trim().min(20).max(5000),
  level: z.enum(COURSE_LEVELS),
  durationValue: z.number().int().min(1).max(999).nullable().optional(),
  durationUnit: z.enum(DURATION_UNITS).nullable().optional(),
  accessType: z.enum(COURSE_ACCESS_TYPES),
  price: z.number().min(0).max(99999999),
  certificateEnabled: z.boolean({
    error: "Select whether this course issues certificates.",
  }),
  highlights: optionalStringArray,
  skills: optionalStringArray,
  prerequisites: optionalStringArray,
  thumbnailUrl: nullableSecureHttpUrlSchema,
  sortOrder: z.number().int().min(0).optional(),
});

function validateCourseConsistency(data, context) {
  if ((data.durationValue == null) !== (data.durationUnit == null)) {
    context.addIssue({
      code: "custom",
      message: "Duration value and unit must be provided together.",
      path: ["durationValue"],
    });
  }

  if (data.accessType === "FREE" && data.price !== 0) {
    context.addIssue({
      code: "custom",
      message: "Free courses must have a zero price.",
      path: ["price"],
    });
  }
}

export const createCourseSchema = courseObject.superRefine(validateCourseConsistency);

export const updateCourseSchema = courseObject
  .omit({ certificateEnabled: true, categoryId: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const courseEnrollmentStatusSchema = z.object({
  status: z.enum(COURSE_ENROLLMENT_STATUSES),
});

export const courseAdminFiltersSchema = z.object({
  serviceType: z.enum(Object.values(LEARNING_SERVICE_TYPES)).optional(),
  categoryId: z.string().uuid().optional(),
  status: z.enum(Object.values(CATALOG_STATUSES)).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  accessType: z.enum(COURSE_ACCESS_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
