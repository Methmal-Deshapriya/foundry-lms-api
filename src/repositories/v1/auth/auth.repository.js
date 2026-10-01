import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
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

/** Same as findUserWithPassword, by id (change-password). */
export async function findUserWithPasswordById(id) {
  return await prisma.user.findUnique({
    where: { id },
    omit: { password: false },
  });
}

/**
 * Re-registration of an address that was never verified: the old row proves
 * nothing (anyone can type any email), so the new sign-up replaces its
 * details instead of being refused. Guarded on emailVerified=false so a
 * verification that lands at the same moment is never overwritten.
 * @returns {Promise<object|null>} The updated user, or null if it got verified meanwhile.
 */
export async function replaceUnverifiedUser(id, data) {
  try {
    const { count } = await prisma.user.updateMany({
      where: { id, emailVerified: false },
      data,
    });
    if (count !== 1) return null;
    return await prisma.user.findUnique({ where: { id } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Change a signed-in user's password and end every other session.
 * @returns {Promise<object>} { id, email, role, securityVersion } after the change.
 */
export async function changeUserPassword(id, hashedPassword) {
  try {
    return await prisma.user.update({
      where: { id },
      data: { password: hashedPassword, securityVersion: { increment: 1 } },
      select: { id: true, email: true, role: true, securityVersion: true },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

/**
 * Administrator login activity over a recent window: how many login-code
 * challenges were issued and how many wrong codes were entered across all
 * of them. Used to cap guessing per account, not just per IP.
 */
export async function getRecentLoginChallengeActivity(userId, since) {
  const [issued, attempts] = await Promise.all([
    prisma.loginChallenge.count({ where: { userId, createdAt: { gte: since } } }),
    prisma.loginChallenge.aggregate({
      where: { userId, createdAt: { gte: since } },
      _sum: { attempts: true },
    }),
  ]);
  return { issued, failedAttempts: attempts._sum.attempts ?? 0 };
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
          // Opening the emailed link proves the inbox belongs to this user.
          emailVerified: true,
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
      return { kind: "INVALID", userId: challenge.userId };
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
    // Same answer as a wrong code, so this endpoint can't reveal accounts.
    throw new ValidationError("Incorrect code. Please try again.", "code");
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
    const error = new ValidationError("Incorrect code. Please try again.", "code");
    // For the audit trail only; never sent to the client (code review M10-07).
    error.challengeUserId = result.userId;
    throw error;
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

/**
 * Deletes student accounts that were never verified and never used, created
 * before `cutoff`. They can't sign in, so they hold nothing but the personal
 * details typed at sign-up. Any relation at all keeps the row (belt and
 * braces: an unverified account shouldn't have any). Their OTP rows cascade.
 */
export async function deleteStaleUnverifiedUsers(cutoff, batchSize) {
  const stale = {
    role: "STUDENT",
    emailVerified: false,
    createdAt: { lte: cutoff },
    enrollments: { none: {} },
    managedEnrollments: { none: {} },
    recordedPayments: { none: {} },
    studentProjects: { none: {} },
    studentProfile: { is: null },
    notificationReceipts: { none: {} },
    courseInterests: { none: {} },
    actorAuditLogs: { none: {} },
    enrollmentRequests: { none: {} },
    contactedEnrollmentRequests: { none: {} },
    uploadedObjects: { none: {} },
  };
  const rows = await prisma.user.findMany({
    where: stale,
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });
  if (rows.length === 0) return 0;
  // The same filter again on delete, so an account verified or used between
  // the two queries is left alone.
  const { count } = await prisma.user.deleteMany({
    where: { ...stale, id: { in: rows.map(({ id }) => id) } },
  });
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
