import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  handlePrismaError,
} from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

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
  return prisma.$transaction(async (transaction) => {
    await acquireTransactionLock(transaction, `password-reset-user:${userId}`);
    await transaction.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return transaction.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    });
  });
}

export async function invalidateUserSessions(userId) {
  return prisma.user.update({
    where: { id: userId },
    data: { securityVersion: { increment: 1 } },
    select: { id: true, securityVersion: true },
  });
}

export async function resetPasswordWithToken(tokenHash, hashedPassword) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const candidate = await transaction.passwordResetToken.findFirst({
        where: {
          tokenHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, userId: true },
      });
      if (!candidate) {
        throw new ValidationError(
          "This reset link is invalid or has expired.",
          "token",
        );
      }
      await acquireTransactionLock(
        transaction,
        `password-reset-user:${candidate.userId}`,
      );
      const resetToken = await transaction.passwordResetToken.findFirst({
        where: {
          id: candidate.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, userId: true },
      });
      if (!resetToken) {
        throw new ConflictError(
          "This reset link has already been used or replaced.",
          "RESET_TOKEN_ALREADY_USED",
        );
      }

      const consumed = await transaction.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new ConflictError(
          "This reset link has already been used.",
          "RESET_TOKEN_ALREADY_USED",
        );
      }
      const user = await transaction.user.update({
        where: { id: resetToken.userId },
        data: {
          password: hashedPassword,
          securityVersion: { increment: 1 },
        },
        select: { id: true, email: true, securityVersion: true },
      });
      await transaction.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      return user;
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function replaceEmailOtp({ userId, codeHash, expiresAt }) {
  return prisma.$transaction(async (transaction) => {
    await acquireTransactionLock(transaction, `email-verification:${userId}`);
    await transaction.emailOtp.updateMany({
      where: { userId, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    return transaction.emailOtp.create({
      data: { userId, codeHash, expiresAt },
    });
  });
}

export async function verifyEmailWithOtp(email, codeHashes, maxAttempts) {
  const result = await prisma.$transaction(async (transaction) => {
    const initialUser = await transaction.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!initialUser) return { kind: "USER_NOT_FOUND" };
    await acquireTransactionLock(
      transaction,
      `email-verification:${initialUser.id}`,
    );
    const user = await transaction.user.findUnique({
      where: { id: initialUser.id },
    });
    if (!user) return { kind: "USER_NOT_FOUND" };
    if (user.emailVerified) return { kind: "ALREADY_VERIFIED" };

    const otp = await transaction.emailOtp.findFirst({
      where: {
        userId: user.id,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) return { kind: "EXPIRED" };
    if (otp.attempts >= maxAttempts) return { kind: "LOCKED" };
    if (!codeHashes.includes(otp.codeHash)) {
      await transaction.emailOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      return { kind: "INVALID" };
    }

    const now = new Date();
    await transaction.emailOtp.updateMany({
      where: { userId: user.id, verifiedAt: null },
      data: { verifiedAt: now },
    });
    const verifiedUser = await transaction.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
    return { kind: "VERIFIED", user: verifiedUser };
  });

  if (result.kind === "USER_NOT_FOUND") {
    throw new NotFoundError("This email isn't registered. Please sign up first.");
  }
  if (result.kind === "ALREADY_VERIFIED") {
    throw new ConflictError("This email is already verified.");
  }
  if (result.kind === "EXPIRED") {
    throw new ValidationError(
      "This code has expired. Please request a new one.",
      "code",
    );
  }
  if (result.kind === "LOCKED") {
    throw new ValidationError(
      "Too many incorrect attempts. Please request a new code.",
      "code",
    );
  }
  if (result.kind === "INVALID") {
    throw new ValidationError("Incorrect code. Please try again.", "code");
  }
  return result.user;
}

export async function createLoginChallenge({ userId, codeHash, expiresAt }) {
  return prisma.$transaction(async (transaction) => {
    await acquireTransactionLock(transaction, `login-mfa-user:${userId}`);
    await transaction.loginChallenge.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return transaction.loginChallenge.create({
      data: { userId, codeHash, expiresAt },
    });
  });
}

export async function verifyLoginChallenge(id, codeHashes, maxAttempts) {
  const result = await prisma.$transaction(async (transaction) => {
    await acquireTransactionLock(transaction, `login-mfa:${id}`);
    const challenge = await transaction.loginChallenge.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!challenge || challenge.usedAt || challenge.expiresAt <= new Date()) {
      return { kind: "EXPIRED" };
    }
    if (challenge.attempts >= maxAttempts) return { kind: "LOCKED" };
    if (!codeHashes.includes(challenge.codeHash)) {
      await transaction.loginChallenge.update({
        where: { id },
        data: { attempts: { increment: 1 } },
      });
      return { kind: "INVALID" };
    }
    const consumed = await transaction.loginChallenge.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) return { kind: "EXPIRED" };
    return { kind: "VERIFIED", user: challenge.user };
  });

  if (result.kind === "EXPIRED") {
    throw new ValidationError(
      "This administrator login challenge is invalid or expired.",
      "challengeId",
    );
  }
  if (result.kind === "LOCKED") {
    throw new ValidationError(
      "Too many incorrect attempts. Sign in again for a new code.",
      "code",
    );
  }
  if (result.kind === "INVALID") {
    throw new ValidationError("Incorrect code. Please try again.", "code");
  }
  return result.user;
}

// Deletes the oldest `batchSize` expired rows of one auth-artifact table.
// Two steps (find the ids, then delete just those) because `deleteMany`
// can't take an `orderBy`/`take` itself — this is how the batch stays
// bounded instead of deleting an unbounded number of rows in one go.
async function cleanupOneArtifactTable(model, cutoffFilter, batchSize) {
  const rows = await model.findMany({
    where: cutoffFilter,
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });
  if (rows.length === 0) return 0;
  const { count } = await model.deleteMany({ where: { id: { in: rows.map(({ id }) => id) } } });
  return count;
}

export async function cleanupExpiredAuthArtifacts(cutoff, batchSize) {
  // Deliberately NOT wrapped in prisma.$transaction: over Prisma Accelerate,
  // an interactive transaction has to reserve a dedicated connection within
  // a short maxWait (~2s), which is prone to P2028 ("Unable to start a
  // transaction in the given time") under cold-start/proxy latency — this
  // job runs immediately on server boot, right when that's most likely.
  // None of these three tables' cleanup depends on another, so there's
  // nothing an interactive transaction was actually protecting here.
  const [emailOtps, loginChallenges, passwordResetTokens] = await Promise.all([
    cleanupOneArtifactTable(
      prisma.emailOtp,
      { OR: [{ expiresAt: { lte: cutoff } }, { verifiedAt: { not: null, lte: cutoff } }] },
      batchSize,
    ),
    cleanupOneArtifactTable(
      prisma.loginChallenge,
      { OR: [{ expiresAt: { lte: cutoff } }, { usedAt: { not: null, lte: cutoff } }] },
      batchSize,
    ),
    cleanupOneArtifactTable(
      prisma.passwordResetToken,
      { OR: [{ expiresAt: { lte: cutoff } }, { usedAt: { not: null, lte: cutoff } }] },
      batchSize,
    ),
  ]);

  return {
    emailOtps,
    loginChallenges,
    passwordResetTokens,
    total: emailOtps + loginChallenges + passwordResetTokens,
  };
}
