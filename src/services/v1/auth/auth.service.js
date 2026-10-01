import bcrypt from "bcryptjs";
import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import * as authModel from "../../../models/v1/auth/auth.model.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  resendOtpSchema,
  verifyLoginChallengeSchema,
  changePasswordSchema,
} from "../../../constants/v1/auth/auth.schema.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import { generateToken } from "../../../utils/jwt.js";
import { generateResetToken, hashResetToken } from "../../../utils/resetToken.js";
import {
  generateOtp,
  hashOtpCandidates,
} from "../../../utils/otp.js";
import {
  hasAuthEmailBudget,
  sendLoginChallengeEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendOtpEmail,
} from "../../../utils/email.js";
import Logger from "../../../utils/logger.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import {
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from "../../../utils/Errors.js";

const MAX_OTP_ATTEMPTS = 5;
const PRIVILEGED_ROLES = new Set([ROLES.ADMIN, ROLES.SUPER_ADMIN]);

// Per-account caps on administrator login codes, on top of the per-IP
// limiters: a leaked admin password spread over many IPs still only gets
// this many codes and wrong guesses per hour.
const ADMIN_CHALLENGE_WINDOW_MS = 60 * 60 * 1000;
const MAX_ADMIN_CHALLENGES_PER_WINDOW = 10;
const MAX_ADMIN_CODE_FAILURES_PER_WINDOW = 15;

// Responses for "is this email known?" endpoints take at least this long,
// so timing doesn't reveal which branch ran.
const ACCOUNT_LOOKUP_MIN_MS = 300;

function waitUntilElapsed(startedAt, minimumMs = ACCOUNT_LOOKUP_MIN_MS) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, minimumMs - (Date.now() - startedAt))));
}

// Compared against when the email is unknown, so a login for a missing
// account costs the same bcrypt work as one with a wrong password.
let dummyPasswordHash;
function getDummyPasswordHash() {
  dummyPasswordHash ??= bcrypt.hashSync("foundry-login-timing-equalizer", 10);
  return dummyPasswordHash;
}

const EMAIL_UNAVAILABLE_MESSAGE =
  "We couldn't send the email right now. Please try again in a few minutes.";

// Sign-in security events for the audit log (code review M10-07): who,
// when, and the request id and IP — never a code, token or password.
function auditAuth(action, user, context, description) {
  recordActionService({
    actorUserId: user.id,
    action,
    entityType: ENTITY_TYPES.USER,
    entityId: user.id,
    description,
    metadata: { requestId: context?.requestId ?? null, ip: context?.ip ?? null },
  });
}

function assertNotSuspended(user) {
  if (user?.disabledAt) {
    throw new ForbiddenError("This account is suspended. Contact Foundry Academy.", "ACCOUNT_SUSPENDED");
  }
}

function createSessionToken(user, mfa) {
  return generateToken({
    id: user.id,
    role: user.role,
    sv: user.securityVersion ?? 0,
    mfa,
  });
}

/**
 * Auth Service - The "Brain"
 * Orchestrates business logic for user registration and authentication.
 */

/**
 * Service: Register a new user into the platform.
 * Does NOT log the user in — the account is created with emailVerified:false
 * and an OTP is emailed; login is blocked until verifyOtpService succeeds.
 * @param {object} userData - The user's registration details (see registerSchema).
 * @returns {Promise<object>} The safe (unverified) user object.
 */
export async function registerService(userData) {
  // 1. Validation: Use the centralized Zod schema (async — email has an MX-record check)
  const validation = await registerSchema.safeParseAsync(userData);

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const {
    firstName,
    lastName,
    email,
    password,
    phone,
    address,
    district,
    dateOfBirth,
    alStream,
  } = validation.data;

  // 2. Duplicate Check. A verified account is a real conflict; an
  // unverified one proves nothing (anyone can type any address), so a new
  // sign-up for it replaces the old details instead of being refused.
  const existingUser = await authRepo.findUserByEmail(email);
  if (existingUser?.emailVerified) {
    throw new ConflictError("A user with this email already exists.");
  }

  // 3. Hashing
  const hashedPassword = await bcrypt.hash(password, 10);

  // 4. Save to Database (unverified)
  const details = {
    firstName,
    lastName,
    password: hashedPassword,
    phone,
    address,
    district,
    dateOfBirth: new Date(dateOfBirth),
    alStream,
  };
  const newUser = existingUser
    ? await authRepo.replaceUnverifiedUser(existingUser.id, details)
    : await authRepo.createUser({ ...details, email, role: ROLES.STUDENT, emailVerified: false });
  if (!newUser) {
    // Verified between the lookup and the update.
    throw new ConflictError("A user with this email already exists.");
  }

  // 5. Generate an OTP, persist only its hash, email the raw code
  const { code, codeHash, expiresAt } = generateOtp();
  await authRepo.replaceEmailOtp({ userId: newUser.id, codeHash, expiresAt });
  let verificationEmailSent = false;
  if (await hasAuthEmailBudget("public")) {
    try {
      await sendOtpEmail(newUser.email, code);
      verificationEmailSent = true;
    } catch (error) {
      Logger.error("Registration verification email delivery failed", {
        userId: newUser.id,
        message: error?.message,
      });
    }
  } else {
    Logger.warn("Registration verification email skipped: daily email budget reached", { userId: newUser.id });
  }

  // 6. Return the safe (unverified) user — no token, no cookie
  return {
    ...authModel.toUserResponse(newUser),
    verificationEmailSent,
  };
}

/**
 * Service: Log in a user.
 * 1. Validate the email and password format.
 * 2. Find the user by email.
 * 3. Verify the password hash.
 * 4. Generate a JWT token.
 *
 * @param {object} credentials - The user's login details (email, password).
 * @returns {Promise<object>} The safe user object and the auth token.
 */
export async function loginService(credentials, context = {}) {
  // 1. Validation: Use the centralized Zod schema

  const validation = loginSchema.safeParse(credentials);

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { email, password } = validation.data;

  // 2. Find User: Use the special repository function to get the password hash
  const user = await authRepo.findUserWithPassword(email);

  if (!user) {
    // Same bcrypt cost as a wrong password, so timing doesn't reveal
    // whether the account exists. Vague error for security!
    await bcrypt.compare(password, getDummyPasswordHash());
    throw new UnauthorizedError("Invalid email or password.");
  }

  // 3. Verify Password: Compare the plain password with the hashed one from the database
  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    // Vague error for security!
    throw new UnauthorizedError("Invalid email or password.");
  }

  // A suspended account can't sign in (code review M10-05). Checked only
  // after the password matched, so it doesn't reveal suspension to guessers.
  assertNotSuspended(user);

  // 4. Block login until the email has been verified via OTP
  if (!user.emailVerified) {
    throw new ForbiddenError(
      "Please verify your email before logging in.",
      "EMAIL_NOT_VERIFIED"
    );
  }

  if (PRIVILEGED_ROLES.has(user.role)) {
    const activity = await authRepo.getRecentLoginChallengeActivity(
      user.id,
      new Date(Date.now() - ADMIN_CHALLENGE_WINDOW_MS),
    );
    if (
      activity.issued >= MAX_ADMIN_CHALLENGES_PER_WINDOW ||
      activity.failedAttempts >= MAX_ADMIN_CODE_FAILURES_PER_WINDOW
    ) {
      Logger.warn("Administrator login codes paused for this account", { userId: user.id, ...activity });
      throw new TooManyRequestsError(
        "Too many administrator sign-in attempts for this account. Try again in an hour, or reset your password if this wasn't you.",
        "ADMIN_LOGIN_LOCKED",
      );
    }
    if (!(await hasAuthEmailBudget("admin"))) {
      throw new ServiceUnavailableError(
        "Today's email limit has been reached, so the administrator login code can't be sent. Try again tomorrow.",
        "EMAIL_UNAVAILABLE",
      );
    }
    const { code, codeHash, expiresAt } = generateOtp();
    // Send first: if the email fails, the admin sees a clear "try again"
    // instead of a server error, and no unusable challenge is stored.
    try {
      await sendLoginChallengeEmail(user.email, code);
    } catch (error) {
      Logger.error("Administrator login code delivery failed", { userId: user.id, message: error?.message });
      throw new ServiceUnavailableError(EMAIL_UNAVAILABLE_MESSAGE, "EMAIL_UNAVAILABLE");
    }
    const challenge = await authRepo.createLoginChallenge({
      userId: user.id,
      codeHash,
      expiresAt,
    });
    return {
      requiresMfa: true,
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
    };
  }

  // 5. Success: Transform to Safe Shape & Generate Token
  const safeUser = authModel.toUserResponse(user);
  const token = createSessionToken(user, false);

  return { user: safeUser, token };
}

/**
 * Service: Request a password reset email.
 * Uses the same response and minimum processing duration for registered and
 * unknown addresses, preventing direct account discovery.
 *
 * @param {object} payload - { email }
 */
export async function forgotPasswordService(payload) {
  const startedAt = Date.now();
  // 1. Validation: Use the centralized Zod schema
  const validation = forgotPasswordSchema.safeParse(payload);

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { email } = validation.data;

  // 2. Look up the user
  const user = await authRepo.findUserByEmail(email);

  if (!user) {
    await waitUntilElapsed(startedAt);
    return;
  }
  if (!(await hasAuthEmailBudget("public"))) {
    // Same reply as always: the reply never says whether an email went out.
    Logger.warn("Password-reset email skipped: daily email budget reached", { userId: user.id });
    await waitUntilElapsed(startedAt);
    return;
  }

  // 3. Generate token, persist only its hash, email the raw token
  const { rawToken, tokenHash, expiresAt } = generateResetToken();

  await authRepo.createPasswordResetToken({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}`;
  sendPasswordResetEmail(user.email, resetUrl).catch((error) => {
    Logger.error("Password-reset email delivery failed", error);
  });
  await waitUntilElapsed(startedAt);
}

export async function logoutService(userId) {
  await authRepo.invalidateUserSessions(userId);
}

/**
 * Service: Reset a user's password using a valid reset token.
 * @param {object} payload - { token, newPassword }
 */
export async function resetPasswordService(payload, context = {}) {
  // 1. Validation: Use the centralized Zod schema
  const validation = resetPasswordSchema.safeParse(payload);

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { token, newPassword } = validation.data;

  // 2. Look up the token by its hash — never by the raw value
  const tokenHash = hashResetToken(token);
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const user = await authRepo.resetPasswordWithToken(tokenHash, hashedPassword);
  auditAuth(AUDIT_ACTIONS.PASSWORD_RESET, user, context, `Password reset by email link for ${user.email}.`);
  try {
    await sendPasswordChangedEmail(user.email);
  } catch (error) {
    Logger.error("Password-changed notification failed", error);
  }
}

/**
 * Service: Verify a newly registered email using its OTP code.
 * This is the moment the user actually gets logged in.
 * @param {object} payload - { email, code }
 */
export async function verifyOtpService(payload) {
  // 1. Validation: Use the centralized Zod schema
  const validation = verifyOtpSchema.safeParse(payload);

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { email, code } = validation.data;

  // 2. Look up the user and their currently-active OTP
  const verifiedUser = await authRepo.verifyEmailWithOtp(
    email,
    hashOtpCandidates(code),
    MAX_OTP_ATTEMPTS,
  );
  assertNotSuspended(verifiedUser);

  const safeUser = authModel.toUserResponse(verifiedUser);
  const token = createSessionToken(verifiedUser, false);

  return { user: safeUser, token };
}

/**
 * Service: Send a fresh OTP code to a not-yet-verified user.
 * @param {object} payload - { email }
 */
export async function resendOtpService(payload) {
  // 1. Validation: Use the centralized Zod schema
  const validation = resendOtpSchema.safeParse(payload);

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { email } = validation.data;
  const startedAt = Date.now();

  // Checked before the lookup, so a full quota answers the same for every
  // address.
  if (!(await hasAuthEmailBudget("public"))) {
    throw new ServiceUnavailableError(
      "Today's email limit has been reached. Please try again tomorrow.",
      "EMAIL_UNAVAILABLE",
    );
  }

  const user = await authRepo.findUserByEmail(email);

  // Unknown and already-verified addresses get the same reply as a real
  // resend, so this endpoint can't be used to discover accounts.
  if (!user || user.emailVerified) {
    await waitUntilElapsed(startedAt);
    return;
  }

  const { code, codeHash, expiresAt } = generateOtp();
  // Send first, then store: if the email fails, the code the student
  // already has keeps working.
  try {
    await sendOtpEmail(user.email, code);
  } catch (error) {
    Logger.error("Verification code resend failed", { userId: user.id, message: error?.message });
    throw new ServiceUnavailableError(EMAIL_UNAVAILABLE_MESSAGE, "EMAIL_UNAVAILABLE");
  }
  await authRepo.replaceEmailOtp({ userId: user.id, codeHash, expiresAt });
  await waitUntilElapsed(startedAt);
}

/**
 * Service: Change the password of the signed-in user.
 * Needs the current password. Every session is ended (securityVersion is
 * bumped), and a fresh token is returned so this browser stays signed in.
 * @param {string} userId
 * @param {object} payload - { currentPassword, newPassword }
 */
export async function changePasswordService(userId, payload, context = {}) {
  const validation = changePasswordSchema.safeParse(payload);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }
  const { currentPassword, newPassword } = validation.data;

  const user = await authRepo.findUserWithPasswordById(userId);
  if (!user) {
    throw new UnauthorizedError("User session not found. Please log in again.");
  }
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    throw new ValidationError("Your current password is incorrect.", "currentPassword");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const updated = await authRepo.changeUserPassword(user.id, hashedPassword);
  auditAuth(AUDIT_ACTIONS.PASSWORD_CHANGED, updated, context, `Password changed by ${updated.email}.`);
  if (await hasAuthEmailBudget("public")) {
    sendPasswordChangedEmail(updated.email).catch((error) => {
      Logger.error("Password-changed notification failed", error);
    });
  }

  // Privileged accounts only ever hold MFA-verified sessions (authenticate
  // rejects anything else), so the replacement token keeps that claim.
  const freshUser = await authRepo.findUserById(user.id);
  return {
    user: authModel.toUserResponse(freshUser),
    token: createSessionToken(updated, PRIVILEGED_ROLES.has(updated.role)),
  };
}

export async function verifyLoginChallengeService(payload, context = {}) {
  const validation = verifyLoginChallengeSchema.safeParse(payload);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { challengeId, code } = validation.data;
  let user;
  try {
    user = await authRepo.verifyLoginChallenge(challengeId, hashOtpCandidates(code), MAX_OTP_ATTEMPTS);
  } catch (error) {
    // A wrong administrator code is worth a trail (code review M10-07).
    if (error?.challengeUserId) {
      auditAuth(AUDIT_ACTIONS.ADMIN_LOGIN_OTP_FAILED, { id: error.challengeUserId }, context, "Wrong administrator sign-in code.");
    }
    throw error;
  }
  assertNotSuspended(user);
  if (!PRIVILEGED_ROLES.has(user.role)) {
    throw new ForbiddenError(
      "This challenge is not valid for an administrator account.",
      "INVALID_LOGIN_CHALLENGE",
    );
  }
  if (!user.emailVerified) {
    throw new ForbiddenError(
      "Please verify your email before logging in.",
      "EMAIL_NOT_VERIFIED",
    );
  }
  auditAuth(AUDIT_ACTIONS.ADMIN_LOGIN, user, context, `Administrator ${user.email} signed in.`);
  return {
    user: authModel.toUserResponse(user),
    token: createSessionToken(user, true),
  };
}

/**
 * Service: Get the current authenticated user's profile.
 * 1. Find the user by their ID.
 * 2. Return a safe, sanitized user object.
 *
 * @param {string} userId - The UUID of the authenticated user.
 * @returns {Promise<object>} The safe user object.
 */
export async function getMeService(userId) {
  // 1. Find User: Ask the Librarian for the user's data by ID
  const user = await authRepo.findUserById(userId);

  if (!user) {
    throw new NotFoundError("User session not found. Please log in again.");
  }

  // 2. Transform to Safe Shape: Sanitize using our Model
  return authModel.toUserResponse(user);
}
