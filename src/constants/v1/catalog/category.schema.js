import { z } from "zod";
import {
  CATALOG_STATUSES,
  VISUAL_KEYS,
} from "./catalog.constants.js";

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const categoryFields = {
  serviceId: z.string().uuid(),
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(SLUG_REGEX, "Slug must contain lowercase letters, numbers, and dashes only."),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(600),
  audienceLabel: z.string().trim().min(2).max(80).nullable().optional(),
  visualKey: z.enum(VISUAL_KEYS),
  badgeLabel: z.string().trim().min(2).max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
};

export const createCategorySchema = z.object(categoryFields);

export const updateCategorySchema = z
  .object({
    slug: categoryFields.slug.optional(),
    title: categoryFields.title.optional(),
    description: categoryFields.description.optional(),
    audienceLabel: categoryFields.audienceLabel,
    visualKey: categoryFields.visualKey.optional(),
    badgeLabel: categoryFields.badgeLabel,
    sortOrder: categoryFields.sortOrder,
  })
  .refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const categoryAdminFiltersSchema = z.object({
  serviceId: categoryFields.serviceId.optional(),
  status: z.enum(Object.values(CATALOG_STATUSES)).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
