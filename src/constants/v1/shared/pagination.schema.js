import { z } from "zod";

export const selfHistoryPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid("Invalid history cursor.").optional(),
});
