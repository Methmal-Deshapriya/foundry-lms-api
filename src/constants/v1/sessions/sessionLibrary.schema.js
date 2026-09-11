import { z } from "zod";
import { nullableSecureHttpUrlSchema } from "../shared/url.schema.js";

export const SESSION_STATUSES = Object.freeze(["DRAFT", "READY", "ARCHIVED"]);

export const sessionTagSchema = z.string().trim().min(1).max(40);

export const sessionContentSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(5000).nullable().optional(),
  recordingUrl: nullableSecureHttpUrlSchema,
  materialUrl: nullableSecureHttpUrlSchema,
  quizUrl: nullableSecureHttpUrlSchema,
  feedbackUrl: nullableSecureHttpUrlSchema,
  durationMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  tags: z.array(sessionTagSchema).max(10).optional(),
});

export const createSessionLibrarySchema = sessionContentSchema
  .extend({
    status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
  })
  .superRefine((data, context) => {
    if (data.status === "READY" && !data.recordingUrl) {
      context.addIssue({
        code: "custom",
        message: "A ready session must have a recording URL.",
        path: ["recordingUrl"],
      });
    }
  });

export const updateSessionLibrarySchema = sessionContentSchema
  .partial()
  .extend({ status: z.enum(["DRAFT", "READY"]).optional() })
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const sessionLibraryFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(SESSION_STATUSES).optional(),
  tag: sessionTagSchema.optional(),
  attachableIntakeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const bulkArchiveSessionsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
