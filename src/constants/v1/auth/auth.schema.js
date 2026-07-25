import { z } from "zod";
import { hasValidMxRecord } from "../../../utils/otp.js";
import { DISTRICTS, AL_STREAMS } from "../users/users.constants.js";

/**
 * Auth Schemas - The "Blueprints"
 * Defines the validation rules for authentication-related inputs.
 */

const PHONE_REGEX = /^0\d{9}$/;
const PHONE_MESSAGE = "Invalid Sri Lankan phone number format (e.g., 0757451258)";

// Schema for registering a new user.
// The email field's MX-record check is async, so this schema must be
// parsed with `safeParseAsync`, not `safeParse`.
export const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z
    .string()
    .email("Invalid email format")
    .refine(
      async (email) => hasValidMxRecord(email.split("@")[1]),
      "This email domain doesn't appear to accept mail. Please check for typos."
    ),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  phone: z.string().regex(PHONE_REGEX, PHONE_MESSAGE),
  address: z.string().min(1, "Address is required"),
  district: z.enum(DISTRICTS, { message: "Please select a valid district" }),
  // Plain date input value (YYYY-MM-DD), not a full ISO datetime string.
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"),
  alStream: z.enum(AL_STREAMS, { message: "Please select a valid A/L stream" }),
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

// Schema for verifying a newly registered email with an OTP code
export const verifyOtpSchema = z.object({
  email: z.string().email("Invalid email format"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// Schema for requesting a new OTP code
export const resendOtpSchema = z.object({
  email: z.string().email("Invalid email format"),
});

// Schema for updating user profile
export const updateProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required").optional(),
  lastName: z.string().min(1, "Last name is required").optional(),
  phone: z.string().regex(PHONE_REGEX, PHONE_MESSAGE).optional(),
  address: z.string().optional(),
  district: z.enum(DISTRICTS, { message: "Please select a valid district" }).optional(),
  dateOfBirth: z.string().datetime("Invalid date format. Expected ISO string.").optional(),
  alStream: z.enum(AL_STREAMS, { message: "Please select a valid A/L stream" }).optional(),
});
