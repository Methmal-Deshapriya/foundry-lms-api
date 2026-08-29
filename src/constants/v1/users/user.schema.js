import { z } from "zod";
import { ROLES } from "./users.constants.js";

export const userListQuerySchema = z.object({
  role: z.enum(Object.values(ROLES)).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const userIdSchema = z.string().uuid("Invalid user ID.");
