import { z } from "zod";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "./audit.constants.js";

export const auditLogQuerySchema = z
  .object({
    action: z.enum(Object.values(AUDIT_ACTIONS)).optional(),
    resourceType: z.enum(Object.values(ENTITY_TYPES)).optional(),
    actorUserId: z.string().uuid("Invalid actor user ID.").optional(),
    entityId: z.string().uuid("Invalid entity ID.").optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().uuid("Invalid audit cursor.").optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "The from date must not be after the to date.",
    path: ["from"],
  });
