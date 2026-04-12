import { z } from "zod";

/**
 * Auth Schemas - The "Blueprints"
 * Defines the validation rules for authentication-related inputs.
 */

// Schema for registering a new user
export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

// Schema for logging in a user
export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});
