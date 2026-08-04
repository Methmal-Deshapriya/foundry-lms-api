import { z } from "zod";
import { ALL_ENROLLMENT_STATUSES, ALL_PAYMENT_STATUSES } from "./enrollment.constants.js";

/**
 * Enrollment Schema
 * Rules for manually enrolling a student and updating their state.
 */
export const enrollUserSchema = z.object({
  userId: z.string().uuid("Invalid User ID format"),
  courseId: z.string().uuid("Invalid Course ID format"),
  paymentStatus: z.enum(ALL_PAYMENT_STATUSES).optional(),
});

export const updateEnrollmentSchema = z.object({
  status: z.enum(ALL_ENROLLMENT_STATUSES).optional(),
  paymentStatus: z.enum(ALL_PAYMENT_STATUSES).optional(),
  paymentCompletedAt: z.string().datetime("Invalid date format. Expected ISO string.").nullable().optional(),
  completedAt: z.string().datetime("Invalid date format. Expected ISO string.").nullable().optional(),
});
