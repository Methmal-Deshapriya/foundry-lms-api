import { z } from "zod";

export const SESSION_REUSE_POLICIES = Object.freeze([
  "SINGLE_COURSE",
  "REUSABLE",
]);

export const SESSION_STATUSES = Object.freeze(["DRAFT", "READY", "ARCHIVED"]);

const nullableUrl = z.string().url("Invalid URL format").nullable().optional();

export const sessionContentSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().max(5000).nullable().optional(),
  recordingUrl: nullableUrl,
  materialUrl: nullableUrl,
  quizUrl: nullableUrl,
  feedbackUrl: nullableUrl,
  durationMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  reusePolicy: z.enum(SESSION_REUSE_POLICIES),
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
  reusePolicy: z.enum(SESSION_REUSE_POLICIES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
