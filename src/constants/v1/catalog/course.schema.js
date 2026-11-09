import { z } from "zod";
import {
  CATALOG_STATUSES,
  COURSE_LEVELS,
  COURSE_ENROLLMENT_STATUSES,
  DURATION_UNITS,
} from "./catalog.constants.js";
import { approvedImageUrlSchema, hostnameOf, secureHttpUrlSchema } from "../shared/url.schema.js";
import { LEARNING_ACCESS_TYPES } from "./learningService.schema.js";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE_PREFIX_REGEX = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const optionalStringArray = z.array(z.string().trim().min(1).max(160)).max(30).optional();

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const nullableYoutubeUrlSchema = secureHttpUrlSchema
  // hostnameOf never throws: zod 4 runs this refine even after the URL
  // check fails, and new URL() on a typo was a 500 (code review M06-07).
  .refine((value) => YOUTUBE_HOSTS.has(hostnameOf(value)), "Must be a youtube.com or youtu.be URL.")
  .nullable()
  .optional();

const whyPursueStep = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(300),
}).strict();
const optionalWhyPursueSteps = z.array(whyPursueStep).max(8).optional();

// The real-world program a student browses and enrolls in — see the
// 2026-08-30 course-to-program-intake rename plan. Every field here is
// content that's identical across every Intake of this course, which is
// exactly why it lives here and not on Intake.
const courseObject = z.object({
  serviceId: z.string().uuid(),
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
  thumbnailUrl: approvedImageUrlSchema,
  thumbnailObjectId: z.string().uuid().nullable().optional(),
  targetAudience: z.string().trim().min(10).max(300).nullable().optional(),
  whyPursueSteps: optionalWhyPursueSteps,
  explainerVideoUrl: nullableYoutubeUrlSchema,
  explainerVideoThumbnailObjectId: z.string().uuid().nullable().optional(),
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
  if (data.thumbnailUrl && data.thumbnailObjectId) {
    context.addIssue({
      code: "custom",
      message: "Use either an uploaded thumbnail or an external thumbnail URL, not both.",
      path: ["thumbnailObjectId"],
    });
  }
  if (data.explainerVideoThumbnailObjectId && !data.explainerVideoUrl) {
    context.addIssue({
      code: "custom",
      message: "An explainer video thumbnail requires an explainer video URL.",
      path: ["explainerVideoThumbnailObjectId"],
    });
  }
}

export const createCourseSchema = courseObject
  .strict("Only documented course fields are accepted.")
  .superRefine(validateDurationConsistency)
  // The full-payment discount can't be changed after creation, so it must be
  // right now: smaller than the price (code review M06-02).
  .refine((data) => data.discountAmount === 0 || data.discountAmount < data.price, {
    message: "The full-payment discount must be less than the price.",
    path: ["discountAmount"],
  });

export const updateCourseSchema = courseObject
  .omit({ serviceId: true, intakeCodePrefix: true, certificateEnabled: true, discountAmount: true })
  .partial()
  .strict("Certificate policy, discount amount, intake code prefix, and parent learning service cannot be changed after course creation.")
  .superRefine(validateDurationConsistency)
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const courseAdminFiltersSchema = z.object({
  serviceId: z.string().uuid().optional(),
  status: z.enum(Object.values(CATALOG_STATUSES)).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  enrollmentStatus: z.enum(COURSE_ENROLLMENT_STATUSES).optional(),
  // "false" must mean false (z.coerce.boolean reads any non-empty string as
  // true) — code review M06-12.
  includeArchived: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// The public, cross-service "Explore" page — every published course across
// every active service, filterable by slug (not id, since this is public
// and callers only ever know slugs) rather than courseAdminFiltersSchema's
// internal ids.
export const publicExploreFiltersSchema = z
  .object({
    service: z.string().trim().min(1).max(100).optional(),
    level: z.enum(COURSE_LEVELS).optional(),
    accessType: z.enum(LEARNING_ACCESS_TYPES).optional(),
    minPrice: z.coerce.number().min(0).max(99999999).optional(),
    maxPrice: z.coerce.number().min(0).max(99999999).optional(),
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .refine((data) => data.minPrice == null || data.maxPrice == null || data.minPrice <= data.maxPrice, {
    message: "Minimum price must not exceed maximum price.",
    path: ["minPrice"],
  });
