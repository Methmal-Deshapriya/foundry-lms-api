import { verifyToken } from "../utils/jwt.js";
import { UnauthorizedError } from "../utils/Errors.js";
import { findUserById } from "../repositories/v1/users/user.repository.js";
import { ROLES } from "../constants/v1/users/users.constants.js";

const PRIVILEGED_ROLES = new Set([ROLES.ADMIN, ROLES.SUPER_ADMIN]);

/**
 * Authentication Middleware - The "Security Guard"
 * Ensures the user is logged in before allowing access to a route.
 */
export const authenticate = async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    // 1. Look for the JWT token in the HTTP-only cookies
    // Note: We'll name our cookie "token" when we build the login logic later.
    const token = req.cookies.token;

    if (!token) {
      // If the cookie is missing, the user is not logged in.
      throw new UnauthorizedError("Authentication required. Please log in.");
    }

    // 2. Verify the token using our JWT utility
    // If the token is fake or expired, verifyToken will throw an error.
    const decoded = verifyToken(token);

    // The token proves identity; current database state decides authority.
    const user = await findUserById(decoded.id);
    if (!user) {
      throw new UnauthorizedError("User session not found. Please log in again.");
    }
    if ((decoded.sv ?? 0) !== (user.securityVersion ?? 0)) {
      throw new UnauthorizedError(
        "This session was invalidated by a security change. Please log in again.",
      );
    }
    if (PRIVILEGED_ROLES.has(user.role) && decoded.mfa !== true) {
      throw new UnauthorizedError(
        "Administrator verification is required. Please log in again.",
      );
    }

    req.user = {
      id: user.id,
      role: user.role,
      emailVerified: user.emailVerified,
    };

    // 4. Everything is good! Move to the next middleware or controller.
    next();
  } catch (error) {
    // If any error occurs (missing token, invalid token, etc.), 
    // we pass it to the global error handler.
    next(error);
  }
};
