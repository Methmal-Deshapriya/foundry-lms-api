import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createRateLimitStore } from "../config/rateLimitStore.js";

function createLimiter({
  windowMs,
  max,
  message,
  skipSuccessfulRequests = false,
  keyGenerator,
  prefix,
}) {
  const store = prefix ? createRateLimitStore(prefix) : undefined;
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    ...(keyGenerator ? { keyGenerator } : {}),
    message: {
      success: false,
      error: message,
      code: "TOO_MANY_REQUESTS",
    },
    ...(store ? { store } : {}),
  });
}

export const registrationLimiter = createLimiter({
  prefix: "registration",
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many registration attempts. Please try again later.",
});

export const loginLimiter = createLimiter({
  prefix: "login-account",
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Please try again later.",
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "missing-email";
    return `${ipKeyGenerator(req.ip)}:${email}`;
  },
});

export const loginIpLimiter = createLimiter({
  prefix: "login-ip",
  windowMs: 15 * 60 * 1000,
  max: 50,
  skipSuccessfulRequests: true,
  message: "Too many login attempts from this network. Please try again later.",
});

export const loginMfaVerificationLimiter = createLimiter({
  prefix: "login-mfa",
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: "Too many administrator verification attempts. Sign in again later.",
});

export const forgotPasswordLimiter = createLimiter({
  prefix: "forgot-password",
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many reset requests. Please try again later.",
});

export const passwordResetLimiter = createLimiter({
  prefix: "password-reset",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password reset attempts. Please try again later.",
});

export const otpVerificationLimiter = createLimiter({
  prefix: "otp-verification",
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: "Too many verification attempts. Please try again later.",
});

export const resendOtpLimiter = createLimiter({
  prefix: "resend-otp",
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "Too many code requests. Please try again later.",
});

export const certificateVerificationLimiter = createLimiter({
  prefix: "certificate-verification",
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many certificate verification requests. Please try again shortly.",
});
