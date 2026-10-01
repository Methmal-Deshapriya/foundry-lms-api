import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createRateLimitStore } from "../config/rateLimitStore.js";

function createLimiter({
  windowMs,
  max,
  message,
  skipSuccessfulRequests = false,
  keyGenerator,
  prefix,
  skip,
}) {
  const store = prefix ? createRateLimitStore(prefix) : undefined;
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    ...(keyGenerator ? { keyGenerator } : {}),
    ...(skip ? { skip } : {}),
    message: {
      success: false,
      error: message,
      code: "TOO_MANY_REQUESTS",
    },
    ...(store ? { store } : {}),
  });
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The normalized email in the request body. Limits keyed on it protect one
// address no matter how many IPs an attacker uses, and let many students on
// one shared IP (classroom Wi-Fi, mobile CGNAT) act without blocking each
// other.
function bodyEmail(req) {
  return typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "missing-email";
}

const byEmail = (req) => `email:${bodyEmail(req)}`;
const byIpAndEmail = (req) => `${ipKeyGenerator(req.ip)}:${bodyEmail(req)}`;

// IP-only and loose: a whole class may register from one venue at once.
// Abuse is bounded by the per-email limits below and the MX check.
export const registrationLimiter = createLimiter({
  prefix: "registration",
  windowMs: HOUR_MS,
  max: 60,
  message: "Too many registration attempts. Please try again later.",
});

export const loginLimiter = createLimiter({
  prefix: "login-account",
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Please try again later.",
  keyGenerator: byIpAndEmail,
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

// Forgot-password sends real email to any address: a loose ceiling per IP,
// plus tight per-address limits so nobody can flood one inbox or burn the
// daily email quota through it.
export const forgotPasswordIpLimiter = createLimiter({
  prefix: "forgot-password-ip",
  windowMs: HOUR_MS,
  max: 50,
  message: "Too many reset requests from this network. Please try again later.",
});

export const forgotPasswordLimiter = createLimiter({
  prefix: "forgot-password",
  windowMs: HOUR_MS,
  max: 3,
  message: "Too many reset requests for this email. Please try again later.",
  keyGenerator: byEmail,
});

export const forgotPasswordDailyLimiter = createLimiter({
  prefix: "forgot-password-day",
  windowMs: DAY_MS,
  max: 10,
  message: "Too many reset requests for this email today. Please try again tomorrow.",
  keyGenerator: byEmail,
});

export const passwordResetLimiter = createLimiter({
  prefix: "password-reset",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password reset attempts. Please try again later.",
});

export const changePasswordLimiter = createLimiter({
  prefix: "change-password",
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: "Too many password change attempts. Please try again later.",
  // Runs after `authenticate`, so the account is known.
  keyGenerator: (req) => `user:${req.user?.id ?? ipKeyGenerator(req.ip)}`,
});

export const otpVerificationLimiter = createLimiter({
  prefix: "otp-verification",
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: "Too many verification attempts. Please try again later.",
  keyGenerator: byIpAndEmail,
});

export const otpVerificationIpLimiter = createLimiter({
  prefix: "otp-verification-ip",
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  message: "Too many verification attempts from this network. Please try again later.",
});

export const resendOtpIpLimiter = createLimiter({
  prefix: "resend-otp-ip",
  windowMs: HOUR_MS,
  max: 50,
  message: "Too many code requests from this network. Please try again later.",
});

export const resendOtpLimiter = createLimiter({
  prefix: "resend-otp",
  windowMs: HOUR_MS,
  max: 3,
  message: "Too many code requests for this email. Please try again later.",
  keyGenerator: byEmail,
});

export const resendOtpDailyLimiter = createLimiter({
  prefix: "resend-otp-day",
  windowMs: DAY_MS,
  max: 10,
  message: "Too many code requests for this email today. Please try again tomorrow.",
  keyGenerator: byEmail,
});

// Student write endpoints that cost something: each upload intent is a DB
// row plus up to a file in R2 until the daily cleanup, and each enrollment
// request emails every admin. Keyed per account (they run after
// `authenticate`); staff are exempt so bulk admin work is never blocked.
const isStudent = (req) => req.user?.role === "STUDENT";
const byUser = (req) => `user:${req.user?.id ?? ipKeyGenerator(req.ip)}`;

export const studentUploadLimiter = createLimiter({
  prefix: "student-uploads",
  windowMs: HOUR_MS,
  max: 30,
  message: "Too many uploads. Please try again in an hour.",
  keyGenerator: byUser,
  skip: (req) => !isStudent(req),
});

export const enrollmentRequestLimiter = createLimiter({
  prefix: "enrollment-requests",
  windowMs: HOUR_MS,
  max: 10,
  message: "Too many enrollment requests. Please try again in an hour.",
  keyGenerator: byUser,
  skip: (req) => !isStudent(req),
});

export const certificateVerificationLimiter = createLimiter({
  prefix: "certificate-verification",
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many certificate verification requests. Please try again shortly.",
});
