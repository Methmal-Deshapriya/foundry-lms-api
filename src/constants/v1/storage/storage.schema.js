import { z } from "zod";

export const STORED_OBJECT_PURPOSES = Object.freeze([
  "COURSE_THUMBNAIL",
  "SESSION_RECORDING",
  "SESSION_MATERIAL",
  "PROJECT_THUMBNAIL",
]);

export const createUploadIntentSchema = z.object({
  purpose: z.enum(STORED_OBJECT_PURPOSES),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  sizeBytes: z.number().int().positive().max(5_368_709_120),
}).strict("Only documented upload fields are accepted.");

export const storedObjectIdSchema = z.string().uuid();
