import { z } from "zod";
const orderIndex = z.number().int().min(0).optional();

export const attachCourseSessionSchema = z.object({
  sessionId: z.string().uuid("Invalid session ID."),
  orderIndex,
});

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
  acknowledgeSequenceRisk: z.boolean().default(false),
});

export const updateCourseSessionDeliverySchema = z.object({
  status: z.enum(["UNRELEASED", "SCHEDULED", "RELEASED", "WITHDRAWN"]),
  availableAt: z.coerce.date().nullable().optional(),
  acknowledgeSequenceRisk: z.boolean().default(false),
}).superRefine((data, context) => {
  if (data.status === "SCHEDULED" && !data.availableAt) {
    context.addIssue({ code: "custom", path: ["availableAt"], message: "Scheduled delivery requires an availability date." });
  }
});
