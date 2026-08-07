import { z } from "zod";
import { ALL_PROJECT_STATUSES } from "./projects.constants.js";

/**
 * Student Project Schemas
 */

export const createProjectSchema = z.object({
  courseId: z.string().uuid("Invalid Course ID format"),
  enrollmentId: z.string().uuid("Invalid Enrollment ID format"),
  title: z.string().min(3, "Title must be at least 3 characters long"),
  description: z.string().optional().nullable(),
  thumbnailUrl: z.string().url("Invalid URL format").optional().nullable(),
  projectUrl: z.string().url("Invalid URL format").optional().nullable(),
  githubUrl: z.string().url("Invalid URL format").optional().nullable(),
  demoUrl: z.string().url("Invalid URL format").optional().nullable(),
  technologies: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
});

export const updateProjectSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long").optional(),
  description: z.string().optional().nullable(),
  thumbnailUrl: z.string().url("Invalid URL format").optional().nullable(),
  projectUrl: z.string().url("Invalid URL format").optional().nullable(),
  githubUrl: z.string().url("Invalid URL format").optional().nullable(),
  demoUrl: z.string().url("Invalid URL format").optional().nullable(),
  technologies: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
});

export const reviewProjectSchema = z.object({
  status: z.enum(ALL_PROJECT_STATUSES),
  adminFeedback: z.string().optional().nullable(),
});
