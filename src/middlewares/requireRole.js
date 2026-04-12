import { ForbiddenError } from "../utils/Errors.js";

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
      // 1. Check if the user exists on the request object.
      // This middleware MUST be used AFTER the 'authenticate' middleware.
      if (!req.user) {
        throw new Error("requireRole middleware used without authentication!");
      }

      // 2. Check if the user's role is included in the allowedRoles list.
      const hasPermission = allowedRoles.includes(req.user.role);

      if (!hasPermission) {
        // If the role is not allowed, throw a 403 Forbidden error.
        throw new ForbiddenError(
          `Access denied. Your role (${req.user.role}) does not have permission for this action.`
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
