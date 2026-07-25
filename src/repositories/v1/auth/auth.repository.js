import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Auth Repository - The "Librarian"
 * The only place that directly communicates with the Database for Auth actions.
 */

/**
 * Find a unique user by their email address.
 * @param {string} email - The email to search for.
 * @returns {Promise<object|null>} The user object or null if not found.
 */
export async function findUserByEmail(email) {
  return await prisma.user.findUnique({
    where: { email },
  });
}

/**
 * Find a unique user by their ID.
 * @param {string} id - The unique UUID of the user.
 * @returns {Promise<object|null>} The user object or null if not found.
 */
export async function findUserById(id) {
  return await prisma.user.findUnique({
    where: { id },
  });
}

/**
 * Find a unique user by their email address and EXPLICITLY include the password.
 * Only use this for authentication/login verification.
 * @param {string} email - The email to search for.
 * @returns {Promise<object|null>} The user object including the password hash.
 */
export async function findUserWithPassword(email) {
  return await prisma.user.findUnique({
    where: { email },
    omit: { password: false }, // Bypasses the Global Omit from utils/prisma.js
  });
}

/**
 * Create a new user record in the database.
 * @param {object} data - The user data (name, email, hashed password, role).
 * @returns {Promise<object>} The newly created user object.
 */
export async function createUser(data) {
  try {
    return await prisma.user.create({
      data,
    });
  } catch (error) {
    // If Prisma throws an error (e.g., P2002 for duplicate email),
    // our foundation handler will turn it into a clean CustomError.
    throw handlePrismaError(error);
  }
}

/**
 * Store a new password reset token for a user.
 * @param {object} data - { userId, tokenHash, expiresAt }
 * @returns {Promise<object>} The created token record.
 */
export async function createPasswordResetToken({ userId, tokenHash, expiresAt }) {
  return await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });
}

/**
 * Find a password reset token by its hash, but only if it is still
 * usable (not expired, not already used).
 * @param {string} tokenHash - SHA-256 hash of the raw token from the reset link.
 * @returns {Promise<object|null>} The token record (with its user) or null.
 */
export async function findValidResetToken(tokenHash) {
  return await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
}

/**
 * Mark a password reset token as used so it can't be replayed.
 * @param {string} id - The token record's ID.
 */
export async function markResetTokenUsed(id) {
  return await prisma.passwordResetToken.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}

/**
 * Update a user's password hash.
 * @param {string} userId
 * @param {string} hashedPassword
 */
export async function updateUserPassword(userId, hashedPassword) {
  return await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });
}

/**
 * Store a new email-verification OTP for a user.
 * @param {object} data - { userId, codeHash, expiresAt }
 * @returns {Promise<object>} The created OTP record.
 */
export async function createEmailOtp({ userId, codeHash, expiresAt }) {
  return await prisma.emailOtp.create({
    data: { userId, codeHash, expiresAt },
  });
}

/**
 * Find the most recent still-usable OTP for a user (not expired, not
 * already verified). Callers compare its codeHash themselves so wrong
 * guesses can still be counted as attempts against this same record.
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function findActiveOtpForUser(userId) {
  return await prisma.emailOtp.findFirst({
    where: {
      userId,
      verifiedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Increment the failed-attempt counter on an OTP record.
 * @param {string} id - The OTP record's ID.
 */
export async function incrementOtpAttempts(id) {
  return await prisma.emailOtp.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });
}

/**
 * Mark an OTP record as verified so it can't be reused.
 * @param {string} id - The OTP record's ID.
 */
export async function markOtpVerified(id) {
  return await prisma.emailOtp.update({
    where: { id },
    data: { verifiedAt: new Date() },
  });
}

/**
 * Mark a user's email as verified.
 * @param {string} userId
 */
export async function markUserEmailVerified(userId) {
  return await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });
}
