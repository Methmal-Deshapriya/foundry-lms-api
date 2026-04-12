import bcrypt from "bcryptjs";
import { z } from "zod";
import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import { generateToken } from "../../../utils/jwt.js";
import { ConflictError, ValidationError } from "../../../utils/Errors.js";

/**
 * Auth Service - The "Brain"
 * Orchestrates business logic for user registration and authentication.
 */

// Define the "New User Blueprint" using Zod
const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

/**
 * Register a new user into the platform.
 * 1. Validate the input data (name, email, password).
 * 2. Check if the email is already in use.
 * 3. Hash the password for security.
 * 4. Save the user to the database.
 * 5. Generate a JWT token for immediate access.
 * 
 * @param {object} userData - The user's registration details.
 * @returns {Promise<object>} The user object (safe) and the auth token.
 */
export async function registerUser(userData) {
  // 1. Validation: Ensure the data matches our blueprint
  const validation = registerSchema.safeParse(userData);

  if (!validation.success) {
    // If validation fails, we extract the first error message and throw a ValidationError
    const firstError = validation.error.errors[0];
    throw new ValidationError(firstError.message, firstError.path[0]);
  }

  const { name, email, password } = validation.data;

  // 2. Duplicate Check: Prevent multiple accounts with the same email
  const existingUser = await authRepo.findUserByEmail(email);
  if (existingUser) {
    throw new ConflictError("A user with this email already exists.");
  }

  // 3. Hashing: Secure the password before storing it
  // The '10' is the work factor (salt rounds).
  const hashedPassword = await bcrypt.hash(password, 10);

  // 4. Save to Database: Use the repository to create the record
  const newUser = await authRepo.createUser({
    name,
    email,
    password: hashedPassword,
    role: "STUDENT", // New users default to STUDENT role as per plan
  });

  // 5. Generate Passport (JWT): Create the auth token
  const token = generateToken({
    id: newUser.id,
    role: newUser.role,
  });

  // 6. Return the "Clean" User and the Token
  // Note: Prisma 7 will automatically omit the password here because we configured it in utils/prisma.js!
  return {
    user: newUser,
    token,
  };
}
