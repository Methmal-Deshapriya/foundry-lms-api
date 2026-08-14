import rateLimit, { ipKeyGenerator } from "express-rate-limit";

function createLimiter({
  windowMs,
  max,
  message,
  skipSuccessfulRequests = false,
  keyGenerator,
}) {
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
  });
}

export const registrationLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many registration attempts. Please try again later.",
});

export const loginLimiter = createLimiter({
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
  windowMs: 15 * 60 * 1000,
  max: 50,
  skipSuccessfulRequests: true,
  message: "Too many login attempts from this network. Please try again later.",
});

export const forgotPasswordLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many reset requests. Please try again later.",
});

export const passwordResetLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password reset attempts. Please try again later.",
});

export const otpVerificationLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: "Too many verification attempts. Please try again later.",
});

export const resendOtpLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "Too many code requests. Please try again later.",
});

export const certificateVerificationLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many certificate verification requests. Please try again shortly.",
});
