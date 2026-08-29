import { z } from "zod";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE_PREFIX_REGEX = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export const createCourseGroupSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().trim().min(3).max(160),
  slug: z.string().trim().min(2).max(100).regex(SLUG_REGEX),
  batchCodePrefix: z.string().trim().min(2).max(80).regex(CODE_PREFIX_REGEX),
  certificateEnabled: z.boolean({
    error: "Select whether this course group issues certificates.",
  }),
}).strict("Only documented course-group fields are accepted.");

export const updateCourseGroupSchema = createCourseGroupSchema
  .omit({ categoryId: true, certificateEnabled: true })
  .partial()
  .strict("Certificate policy and parent category cannot be changed after course-group creation.")
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const courseGroupAdminFiltersSchema = z.object({
  categoryId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  includeArchived: z.coerce.boolean().default(false),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
