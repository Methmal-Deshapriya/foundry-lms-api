import { z } from "zod";
import { ALL_PROJECT_STATUSES } from "./projects.constants.js";
import {
  nullableSecureHttpUrlSchema,
  projectThumbnailUrlSchema,
} from "../shared/url.schema.js";

/**
 * Student Project Schemas
 */

export const createProjectSchema = z.object({
  intakeId: z.string().uuid("Invalid Intake ID format"),
  enrollmentId: z.string().uuid("Invalid Enrollment ID format"),
  title: z.string().trim().min(3, "Title must be at least 3 characters long").max(180),
  description: z.string().trim().max(10000).optional().nullable(),
  thumbnailUrl: projectThumbnailUrlSchema,
  projectUrl: nullableSecureHttpUrlSchema,
  githubUrl: nullableSecureHttpUrlSchema,
  demoUrl: nullableSecureHttpUrlSchema,
  technologies: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  isPublic: z.boolean().optional(),
});

export const updateProjectSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters long").max(180).optional(),
  description: z.string().trim().max(10000).optional().nullable(),
  thumbnailUrl: projectThumbnailUrlSchema,
  projectUrl: nullableSecureHttpUrlSchema,
  githubUrl: nullableSecureHttpUrlSchema,
  demoUrl: nullableSecureHttpUrlSchema,
  technologies: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  isPublic: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const reviewProjectSchema = z.object({
  status: z.enum(ALL_PROJECT_STATUSES),
  adminFeedback: z.string().trim().max(5000).optional().nullable(),
});
