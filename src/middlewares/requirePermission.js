import { hasPermission } from "../constants/v1/auth/permissions.constants.js";
import { ForbiddenError, UnauthorizedError } from "../utils/Errors.js";

export const requirePermission = (permission) => {
  if (!permission) {
    throw new Error("requirePermission requires a permission.");
  }

  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError(
          "requirePermission middleware used without authentication!",
        );
      }

      if (!hasPermission(req.user.role, permission)) {
        throw new ForbiddenError(
          "Access denied. You do not have permission for this action.",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
