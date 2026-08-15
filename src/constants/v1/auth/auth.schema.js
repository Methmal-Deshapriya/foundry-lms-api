import { z } from "zod";
import { hasValidMxRecord } from "../../../utils/otp.js";
import { DISTRICTS, AL_STREAMS } from "../users/users.constants.js";

/**
 * Auth Schemas - The "Blueprints"
 * Defines the validation rules for authentication-related inputs.
 */

const PHONE_REGEX = /^0\d{9}$/;
const PHONE_MESSAGE = "Invalid Sri Lankan phone number format (e.g., 0757451258)";
const personNameSchema = (label) =>
  z.string().trim().min(1, `${label} is required`).max(80, `${label} is too long`);
const addressSchema = z
  .string()
  .trim()
  .min(1, "Address is required")
  .max(300, "Address must not exceed 300 characters");
const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Expected YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Date of birth must be a real calendar date.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    const today = new Date();
    const oldest = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()));
    return date <= today && date >= oldest;
  }, "Date of birth must be in the past and no more than 120 years ago.");
const normalizedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email format");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must not exceed 72 UTF-8 bytes.",
  );

// Schema for registering a new user.
// The email field's MX-record check is async, so this schema must be
// parsed with `safeParseAsync`, not `safeParse`.
export const registerSchema = z.object({
  firstName: personNameSchema("First name"),
  lastName: personNameSchema("Last name"),
  email: normalizedEmailSchema
    .refine(
      async (email) => hasValidMxRecord(email.split("@")[1]),
      "This email domain doesn't appear to accept mail. Please check for typos."
    ),
  password: passwordSchema,
  phone: z.string().regex(PHONE_REGEX, PHONE_MESSAGE),
  address: addressSchema,
  district: z.enum(DISTRICTS, { message: "Please select a valid district" }),
  // Plain date input value (YYYY-MM-DD), not a full ISO datetime string.
  dateOfBirth: birthDateSchema,
  alStream: z.enum(AL_STREAMS, { message: "Please select a valid A/L stream" }),
});

// Schema for logging in a user
export const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(1, "Password is required"),
});

// Schema for requesting a password reset email
export const forgotPasswordSchema = z.object({
  email: normalizedEmailSchema,
});

// Schema for setting a new password from a reset link
export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: passwordSchema,
});

// Schema for verifying a newly registered email with an OTP code
export const verifyOtpSchema = z.object({
  email: normalizedEmailSchema,
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// Schema for requesting a new OTP code
export const resendOtpSchema = z.object({
  email: normalizedEmailSchema,
});

export const verifyLoginChallengeSchema = z.object({
  challengeId: z.string().uuid("Invalid login challenge."),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

// Schema for updating user profile
export const updateProfileSchema = z.object({
  firstName: personNameSchema("First name").optional(),
  lastName: personNameSchema("Last name").optional(),
  phone: z.string().regex(PHONE_REGEX, PHONE_MESSAGE).optional(),
  address: addressSchema.optional(),
  district: z.enum(DISTRICTS, { message: "Please select a valid district" }).optional(),
  dateOfBirth: birthDateSchema.optional(),
  alStream: z.enum(AL_STREAMS, { message: "Please select a valid A/L stream" }).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, {
  message: "At least one profile field is required.",
});
