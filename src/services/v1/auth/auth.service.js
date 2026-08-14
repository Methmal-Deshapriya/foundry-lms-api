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
} from "../../../constants/v1/auth/auth.schema.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import { generateToken } from "../../../utils/jwt.js";
import { generateResetToken, hashResetToken } from "../../../utils/resetToken.js";
import { generateOtp, hashOtp } from "../../../utils/otp.js";
import {
  sendLoginChallengeEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendOtpEmail,
} from "../../../utils/email.js";
import Logger from "../../../utils/logger.js";
import {
  ConflictError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from "../../../utils/Errors.js";

const MAX_OTP_ATTEMPTS = 5;
const PRIVILEGED_ROLES = new Set([ROLES.ADMIN, ROLES.SUPER_ADMIN]);

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

  // 2. Duplicate Check
  const existingUser = await authRepo.findUserByEmail(email);
  if (existingUser) {
    throw new ConflictError("A user with this email already exists.");
  }

  // 3. Hashing
  const hashedPassword = await bcrypt.hash(password, 10);

  // 4. Save to Database (unverified)
  const newUser = await authRepo.createUser({
    firstName,
    lastName,
    email,
    password: hashedPassword,
    phone,
    address,
    district,
    dateOfBirth: new Date(dateOfBirth),
    alStream,
    role: ROLES.STUDENT,
    emailVerified: false,
  });

  // 5. Generate an OTP, persist only its hash, email the raw code
  const { code, codeHash, expiresAt } = generateOtp();
  await authRepo.replaceEmailOtp({ userId: newUser.id, codeHash, expiresAt });
  await sendOtpEmail(newUser.email, code);

  // 6. Return the safe (unverified) user — no token, no cookie
  return authModel.toUserResponse(newUser);
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
export async function loginService(credentials) {
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
    // Vague error for security!
    throw new UnauthorizedError("Invalid email or password.");
  }

  // 3. Verify Password: Compare the plain password with the hashed one from the database
  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    // Vague error for security!
    throw new UnauthorizedError("Invalid email or password.");
  }

  // 4. Block login until the email has been verified via OTP
  if (!user.emailVerified) {
    throw new ForbiddenError(
      "Please verify your email before logging in.",
      "EMAIL_NOT_VERIFIED"
    );
  }

  if (PRIVILEGED_ROLES.has(user.role)) {
    const { code, codeHash, expiresAt } = generateOtp();
    const challenge = await authRepo.createLoginChallenge({
      userId: user.id,
      codeHash,
      expiresAt,
    });
    await sendLoginChallengeEmail(user.email, code);
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
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 300 - (Date.now() - startedAt))));
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
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 300 - (Date.now() - startedAt))));
}

/**
 * Service: Reset a user's password using a valid reset token.
 * @param {object} payload - { token, newPassword }
 */
export async function resetPasswordService(payload) {
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
    hashOtp(code),
    MAX_OTP_ATTEMPTS,
  );

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

  const user = await authRepo.findUserByEmail(email);

  if (!user) {
    throw new NotFoundError("This email isn't registered. Please sign up first.");
  }

  if (user.emailVerified) {
    throw new ConflictError("This email is already verified.");
  }

  const { code, codeHash, expiresAt } = generateOtp();
  await authRepo.replaceEmailOtp({ userId: user.id, codeHash, expiresAt });
  await sendOtpEmail(user.email, code);
}

export async function verifyLoginChallengeService(payload) {
  const validation = verifyLoginChallengeSchema.safeParse(payload);
  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { challengeId, code } = validation.data;
  const user = await authRepo.verifyLoginChallenge(
    challengeId,
    hashOtp(code),
    MAX_OTP_ATTEMPTS,
  );
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
