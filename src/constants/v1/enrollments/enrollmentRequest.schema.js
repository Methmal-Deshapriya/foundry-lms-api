import { z } from "zod";
import { manualEnrollmentSchema } from "./enrollment.schema.js";

const ENROLLMENT_REQUEST_STATUSES = ["PENDING", "CONTACTED", "ENROLLED", "DECLINED"];

export const createEnrollmentRequestSchema = z.object({
  contactPhone: z.string().trim().min(6).max(30),
}).strict("Only a contact phone number is accepted.");

// PENDING is included so a Declined request can be reopened (Q2 of the
// 2026-08-30 system guide/audit) — the student's original contactPhone and
// history stay attached instead of forcing a fresh resubmission.
export const enrollmentRequestStatusSchema = z.object({
  status: z.enum(["PENDING", "CONTACTED", "DECLINED"]),
});

// The student and intake are already fixed by the request itself — this is
// just the payment details, same shape the direct search-and-enroll flow
// uses, so both entry points share one schema for what "enroll" means.
export const enrollFromRequestSchema = manualEnrollmentSchema.omit({ userId: true });

export const enrollmentRequestFiltersSchema = z.object({
  status: z.enum(ENROLLMENT_REQUEST_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
