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

// Schema for requesting a password reset email
export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format"),
});

// Schema for setting a new password from a reset link
export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters long"),
});

// Schema for updating user profile
export const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long").optional(),
  phone: z
    .string()
    .regex(/^0\d{9}$/, "Invalid Sri Lankan phone number format (e.g., 0757451258)")
    .optional(),
  address: z.string().optional(),
  district: z.string().optional(),
  dateOfBirth: z.string().datetime("Invalid date format. Expected ISO string.").optional(),
  alStream: z.string().optional(),
});
