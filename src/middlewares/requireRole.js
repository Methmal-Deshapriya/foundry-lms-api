import { ForbiddenError, UnauthorizedError } from "../utils/Errors.js";

/**
 * Role-Based Authorization Middleware - The "Clearance Level Guard"
 * Restricts access to specific roles (e.g., ADMIN, SUPER_ADMIN).
 *
 * This is a Higher-Order Function: it takes allowedRoles and returns a middleware.
 *
 * @param {string[]} allowedRoles - Array of roles permitted to access the route
 */
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
        throw new Error("requireRole requires a non-empty allowedRoles array.");
      }
      // 1. Check if the user exists on the request object.
      // This middleware MUST be used AFTER the 'authenticate' middleware.
      if (!req.user) {
        throw new UnauthorizedError(
          "requireRole middleware used without authentication!",
        );
      }

      if (!req.user.role) {
        throw new ForbiddenError("Access denied. User role is missing.");
      }

      // 4. Role not allowed
      if (!allowedRoles.includes(req.user.role)) {
        throw new ForbiddenError(
          "Access denied. You do not have permission for this action.",
        );
      }

      // 3. Permission granted! Move to the next middleware or controller.
      next();
    } catch (error) {
      // Pass the error to the global error handler.
      next(error);
    }
  };
};
