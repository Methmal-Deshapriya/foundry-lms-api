import { z } from "zod";
import { sessionContentSchema } from "../sessions/sessionLibrary.schema.js";

const orderIndex = z.number().int().min(0).optional();

export const attachCourseSessionSchema = z.union([
  z.object({
    sessionId: z.string().uuid("Invalid session ID."),
    orderIndex,
  }),
  z.object({
    session: sessionContentSchema,
    orderIndex,
  }),
]);

export const courseCurriculumQuerySchema = z.object({
  includeRetired: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const reorderCourseCurriculumSchema = z.object({
  courseSessions: z
    .array(
      z.object({
        id: z.string().uuid("Invalid course-session ID."),
        orderIndex: z.number().int().min(0),
      }),
    )
    .min(1),
});

