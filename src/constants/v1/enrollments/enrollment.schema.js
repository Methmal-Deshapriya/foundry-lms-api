import { z } from "zod";

/**
 * Enrollment Schema
 * Rules for manually enrolling a student.
 */
export const enrollUserSchema = z.object({
  userId: z.string().uuid("Invalid User ID format"),
  bootcampId: z.string().uuid("Invalid Bootcamp ID format"),
});
