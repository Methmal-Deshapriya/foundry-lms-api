import { verifyToken } from "../utils/jwt.js";
import { UnauthorizedError } from "../utils/Errors.js";

/**
 * Authentication Middleware - The "Security Guard"
 * Ensures the user is logged in before allowing access to a route.
 */
export const authenticate = (req, res, next) => {
  try {
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

    // 3. Attach the decoded user data (id, role) to the request object.
    // This makes the user's info available in the Controller and Service layers.
    req.user = {
      id: decoded.id,
      role: decoded.role,
    };

    // 4. Everything is good! Move to the next middleware or controller.
    next();
  } catch (error) {
    // If any error occurs (missing token, invalid token, etc.), 
    // we pass it to the global error handler.
    next(error);
  }
};
