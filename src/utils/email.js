import nodemailer from "nodemailer";

/**
 * Email Utility - The "Mailroom"
 * Wraps a Nodemailer SMTP transporter so the rest of the app never
 * touches the transport details directly.
 */

let transporter;

const getTransporter = () => {
  if (!transporter) {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    if (!user || !pass) {
      throw new Error("SMTP_USER or SMTP_PASSWORD is missing in environment variables!");
    }

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false, // STARTTLS on port 587, not implicit TLS
      auth: { user, pass },
    });
  }

  return transporter;
};

/**
 * Send a password reset email containing the reset link.
 * @param {string} to - Recipient email address
 * @param {string} resetUrl - Fully-built link to the client's reset-password page
 */
export const sendPasswordResetEmail = async (to, resetUrl) => {
  const from = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  // Nodemailer throws on send failure (auth errors, connection errors,
  // rejected recipients), so unlike some provider SDKs, no separate
  // error-shape check is needed here.
  await getTransporter().sendMail({
    from,
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
  const from = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  await getTransporter().sendMail({
    from,
    to,
    subject: "Verify your Foundry LMS email",
    html: `
      <p>Welcome to Foundry LMS! Use the code below to verify your email address:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
      <p>This code expires in 10 minutes. If you didn't create this account, you can safely ignore this email.</p>
    `,
  });
};
