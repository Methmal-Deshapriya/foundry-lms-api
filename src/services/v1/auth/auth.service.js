import bcrypt from "bcryptjs";
import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import * as authModel from "../../../models/v1/auth/auth.model.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../../../constants/v1/auth/auth.schema.js";
import { ROLES } from "../../../constants/v1/users/users.constants.js";
import { generateToken } from "../../../utils/jwt.js";
import { generateResetToken, hashResetToken } from "../../../utils/resetToken.js";
import { sendPasswordResetEmail } from "../../../utils/email.js";
import {
  ConflictError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
} from "../../../utils/Errors.js";

/**
 * Auth Service - The "Brain"
 * Orchestrates business logic for user registration and authentication.
 */

/**
 * Service: Register a new user into the platform.
 * @param {object} userData - The user's registration details (name, email, password).
 * @returns {Promise<object>} The safe user object and the auth token.
 */
export async function registerService(userData) {
  // 1. Validation: Use the centralized Zod schema
  const validation = registerSchema.safeParse(userData);

  if (!validation.success) {
    const firstError = validation.error.issues[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { name, email, password } = validation.data;

  // 2. Duplicate Check
  const existingUser = await authRepo.findUserByEmail(email);
  if (existingUser) {
    throw new ConflictError("A user with this email already exists.");
  }

  // 3. Hashing
  const hashedPassword = await bcrypt.hash(password, 10);

  // 4. Save to Database
  const newUser = await authRepo.createUser({
    name,
    email,
    password: hashedPassword,
    role: ROLES.STUDENT,
  });

  // 5. Transform to Safe Shape & Generate Token
  const safeUser = authModel.toUserResponse(newUser);
  const token = generateToken({ id: safeUser.id, role: safeUser.role });

  return { user: safeUser, token };
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

  // 4. Success: Transform to Safe Shape & Generate Token
  const safeUser = authModel.toUserResponse(user);
  const token = generateToken({ id: safeUser.id, role: safeUser.role });

  return { user: safeUser, token };
}

/**
 * Service: Request a password reset email.
 * Reveals whether the email is registered (throws NotFoundError if not) —
 * a deliberate product choice favoring UX over enumeration-hardening.
 *
 * @param {object} payload - { email }
 */
export async function forgotPasswordService(payload) {
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
    throw new NotFoundError("This email isn't registered. Please try another one, or sign up.");
  }

  // 3. Generate token, persist only its hash, email the raw token
  const { rawToken, tokenHash, expiresAt } = generateResetToken();

  await authRepo.createPasswordResetToken({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);
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
  const resetToken = await authRepo.findValidResetToken(tokenHash);

  if (!resetToken) {
    throw new ValidationError("This reset link is invalid or has expired.", "token");
  }

  // 3. Hash the new password and update the user
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await authRepo.updateUserPassword(resetToken.userId, hashedPassword);

  // 4. Burn the token so it can't be replayed
  await authRepo.markResetTokenUsed(resetToken.id);
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
