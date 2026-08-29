import { z } from "zod";
import {
  COURSE_LEVELS,
  COURSE_STATUSES,
  DURATION_UNITS,
} from "./catalog.constants.js";
import { nullableSecureHttpUrlSchema } from "../shared/url.schema.js";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const optionalStringArray = z.array(z.string().trim().min(1).max(160)).max(30).optional();

const courseObject = z.object({
  courseGroupId: z.string().uuid(),
  sourceCourseId: z.string().uuid().optional(),
  intakeKey: z.string().trim().min(2).max(40).regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/),
  startDate: z.coerce.date().nullable().optional(),
  expectedEndDate: z.coerce.date().nullable().optional(),
  timezone: z.string().trim().min(1).max(100).default("Asia/Colombo"),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
  slug: z.string().min(2).max(100).regex(SLUG_REGEX).optional(),
  title: z.string().trim().min(3).max(160).optional(),
  summary: z.string().trim().min(10).max(300).optional(),
  description: z.string().trim().min(20).max(5000).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  durationValue: z.number().int().min(1).max(999).nullable().optional(),
  durationUnit: z.enum(DURATION_UNITS).nullable().optional(),
  price: z.number().min(0).max(99999999).optional(),
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

export const createCourseSchema = courseObject
  .strict("Only documented course fields are accepted. Certificate policy belongs to the course group.")
  .superRefine(validateCourseConsistency);

export const updateCourseSchema = courseObject
  .pick({ startDate: true, expectedEndDate: true, timezone: true, capacity: true })
  .partial()
  .strict("Only dates, timezone, and capacity can be changed after course creation.")
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const courseStatusSchema = z.object({
  status: z.enum(COURSE_STATUSES),
  expectedStatus: z.enum(COURSE_STATUSES),
});

export const courseAdminFiltersSchema = z.object({
  serviceId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  courseGroupId: z.string().uuid().optional(),
  status: z.enum(COURSE_STATUSES).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
