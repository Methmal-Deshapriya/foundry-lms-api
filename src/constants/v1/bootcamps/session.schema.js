import { z } from "zod";

/**
 * Session Schemas
 */

export const createSessionSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long"),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().min(0),
  recordingUrl: z.string().url("Invalid URL format").optional().nullable(),
  materialUrl: z.string().url("Invalid URL format").optional().nullable(),
  quizUrl: z.string().url("Invalid URL format").optional().nullable(),
  feedbackUrl: z.string().url("Invalid URL format").optional().nullable(),
  durationMinutes: z.number().int().min(0).optional().nullable(),
  isPublished: z.boolean().optional(),
});

export const updateSessionSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long").optional(),
  description: z.string().optional().nullable(),
  orderIndex: z.number().int().min(0).optional(),
  recordingUrl: z.string().url("Invalid URL format").optional().nullable(),
  materialUrl: z.string().url("Invalid URL format").optional().nullable(),
  quizUrl: z.string().url("Invalid URL format").optional().nullable(),
  feedbackUrl: z.string().url("Invalid URL format").optional().nullable(),
  durationMinutes: z.number().int().min(0).optional().nullable(),
  isPublished: z.boolean().optional(),
});

export const reorderSessionsSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string().uuid(),
      orderIndex: z.number().int().min(0),
    })
  ),
});
