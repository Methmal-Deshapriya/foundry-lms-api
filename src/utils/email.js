import { Resend } from "resend";

/**
 * Email Utility - The "Mailroom"
 * Wraps the Resend client so the rest of the app never touches
 * the provider SDK directly.
 */

let resendClient;

const getResendClient = () => {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      throw new Error("RESEND_API_KEY is missing in environment variables!");
    }

    resendClient = new Resend(apiKey);
  }

  return resendClient;
};

/**
 * Send a password reset email containing the reset link.
 * @param {string} to - Recipient email address
 * @param {string} resetUrl - Fully-built link to the client's reset-password page
 */
export const sendPasswordResetEmail = async (to, resetUrl) => {
  const from = process.env.RESEND_FROM_EMAIL;

  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is missing in environment variables!");
  }

  // The Resend SDK does not throw on API errors — it resolves with
  // { data, error }, so failures must be checked explicitly or they
  // silently disappear (the caller would think the email was sent).
  const { error } = await getResendClient().emails.send({
    from,
    to,
    subject: "Reset your Foundry LMS password",
    html: `
      <p>We received a request to reset your Foundry LMS password.</p>
      <p><a href="${resetUrl}">Click here to choose a new password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `,
  });

  if (error) {
    throw new Error(`Failed to send password reset email: ${error.message}`);
  }
};
