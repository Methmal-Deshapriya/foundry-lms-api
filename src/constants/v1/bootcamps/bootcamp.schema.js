import { z } from "zod";

/**
 * Bootcamp Schemas - The "Blueprints"
 * Defines validation rules for creating and updating courses.
 */

// Regex for URL-friendly slugs: lowercase letters, numbers, and dashes only
const SLUG_REGEX = /^[a-z0-9-]+$/;

export const createBootcampSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long"),
  slug: z.string().regex(SLUG_REGEX, "Slug must be URL-friendly (lowercase, numbers, and dashes only)"),
  description: z.string().optional(),
  price: z.number().min(0, "Price cannot be negative"),
});

export const updateBootcampSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long").optional(),
  slug: z.string().regex(SLUG_REGEX, "Slug must be URL-friendly").optional(),
  description: z.string().optional(),
  price: z.number().min(0, "Price cannot be negative").optional(),
  isPublished: z.boolean().optional(),
});
