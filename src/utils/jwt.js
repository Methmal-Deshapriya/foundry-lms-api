import jwt from "jsonwebtoken";
import { UnauthorizedError } from "./Errors.js";

/**
 * JWT Utility - The "Passport Office"
 * Handles creating and verifying security tokens.
 */

/**
 * Generate a new JWT token for a user.
 * @param {object} payload - Data to store in the token (usually { id, role })
 * @returns {string} The encrypted JWT string
 */
export const generateToken = (payload) => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || "1d";

  if (!secret) {
    throw new Error("JWT_SECRET is missing in environment variables!");
  }

  // Create the encrypted token string
  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Verify if a JWT token is valid and hasn't been tampered with.
 * @param {string} token - The JWT string to verify
 * @returns {object} The decoded payload data if valid
 * @throws {UnauthorizedError} If the token is invalid or expired
 */
export const verifyToken = (token) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("JWT_SECRET is missing in environment variables!");
  }

  try {
    // Attempt to decode the token using our master key
    return jwt.verify(token, secret);
  } catch (error) {
    // If verification fails (expired, tampered, or wrong key),
    // we throw a standardized UnauthorizedError from our foundation.
    throw new UnauthorizedError("Invalid or expired token. Please login again.");
  }
};
