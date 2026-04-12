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
