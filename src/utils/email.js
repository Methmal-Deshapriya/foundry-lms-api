import { Resend } from "resend";

/**
 * Email Utility - The "Mailroom"
 * Wraps the Resend HTTP API so the rest of the app never touches the
 * transport details directly. Previously wrapped a Nodemailer/Gmail SMTP
 * transporter — migrated off that because Render's free tier blocks
 * outbound SMTP ports, so every send there failed with ETIMEDOUT on the
 * connection handshake. Resend's API is a plain HTTPS POST, which isn't
 * subject to that restriction.
 */

let client;
let lastVerifiedAt = 0;

const EMAIL_READINESS_CACHE_MS = Number(process.env.EMAIL_READINESS_CACHE_MS ?? 60_000);

function getClient() {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is missing in environment variables!");
    }
    client = new Resend(apiKey);
  }
  return client;
}

function getFromAddress() {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is missing in environment variables!");
  }
  return from;
}

// Resend's SDK resolves with `{ data, error }` rather than throwing on
// failure. Every call site in this app (auth.service.js's awaited sends,
// enrollmentRequest.service.js's fire-and-forget `.catch()`) was written
// against Nodemailer's throw-on-failure contract, so this throws instead —
// keeping every existing try/catch and `.catch()` call site correct
// unchanged, rather than requiring a matching rewrite at every call site.
async function send(message) {
  const { error } = await getClient().emails.send(message);
  if (error) {
    throw new Error(`Resend email delivery failed (${error.name}): ${error.message}`);
  }
}

/**
 * Send a password reset email containing the reset link.
 * @param {string} to - Recipient email address
 * @param {string} resetUrl - Fully-built link to the client's reset-password page
 */
export const sendPasswordResetEmail = async (to, resetUrl) => {
  await send({
    from: getFromAddress(),
    to,
    subject: "Reset your Foundry LMS password",
    html: `
      <p>We received a request to reset your Foundry LMS password.</p>
      <p><a href="${resetUrl}">Click here to choose a new password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
};

/**
 * Send an email-verification code for a newly registered account.
 * @param {string} to - Recipient email address
 * @param {string} code - The raw 6-digit OTP
 */
export const sendOtpEmail = async (to, code) => {
  await send({
    from: getFromAddress(),
    to,
    subject: "Verify your Foundry LMS email",
    html: `
      <p>Welcome to Foundry LMS! Use the code below to verify your email address:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>This code expires in 10 minutes. If you didn't create this account, you can safely ignore this email.</p>
    `,
  });
};

// There's no SMTP handshake to verify anymore — Resend is a stateless HTTPS
// API, and the sending-scoped API key this app uses (least-privilege on
// purpose) can't call any account-level read endpoint to "ping" it, so
// there's nothing to round-trip-check short of actually sending an email.
// This instead confirms the config a send actually needs is present, which
// is what this check exists to catch in practice — a missing/misconfigured
// env var reaching production undetected.
export const checkEmailReadiness = async ({ force = false } = {}) => {
  if (!force && Date.now() - lastVerifiedAt < EMAIL_READINESS_CACHE_MS) return;
  getClient();
  getFromAddress();
  lastVerifiedAt = Date.now();
};

export const sendLoginChallengeEmail = async (to, code) => {
  await send({
    from: getFromAddress(),
    to,
    subject: "Your Foundry LMS administrator login code",
    html: `
      <p>A login was requested for your Foundry LMS administrator account.</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>This code expires in 10 minutes. If this was not you, reset your password immediately.</p>
    `,
  });
};

/**
 * Notify an admin/super-admin that a visitor requested to enroll in a PAID
 * course, linking straight to that request in the intake workspace. See the
 * 2026-08-30 rename plan §8a.
 */
export const sendEnrollmentRequestNotificationEmail = async (to, { courseTitle, intakeCode, studentName, requestUrl }) => {
  await send({
    from: getFromAddress(),
    to,
    subject: `New enrollment request: ${courseTitle}`,
    html: `
      <p>${studentName} requested to enroll in <strong>${courseTitle}</strong> (intake ${intakeCode}).</p>
      <p><a href="${requestUrl}">Open the request</a> to contact the student and record payment once they've paid.</p>
    `,
  });
};

export const sendPasswordChangedEmail = async (to) => {
  await send({
    from: getFromAddress(),
    to,
    subject: "Your Foundry LMS password was changed",
    html: `
      <p>Your Foundry LMS password was changed successfully.</p>
      <p>All existing sessions have been invalidated. If you did not make this change, contact Foundry Academy immediately.</p>
    `,
  });
};
