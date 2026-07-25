import Logger from "./logger.js";

/**
 * Base class for all custom errors in the system.
 */
export class CustomError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.timestamp = new Date().toISOString();

    // Capture stack trace for easier debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * 400 Bad Request — Use for validation failures.
 */
export class ValidationError extends CustomError {
  constructor(message, field = null, details = null) {
    super(message, 400, "VALIDATION_ERROR");
    this.field = field;
    if (details != null) this.details = details;
  }
}

/**
 * 401 Unauthorized — Use when the user is not logged in.
 */
export class UnauthorizedError extends CustomError {
  constructor(message = "Unauthorized request") {
    super(message, 401, "UNAUTHORIZED");
  }
}

/**
 * 403 Forbidden — Use when the user is logged in but lacks permissions.
 */
export class ForbiddenError extends CustomError {
  constructor(message = "Forbidden", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

/**
 * 404 Not Found — Use when a requested resource is missing.
 */
export class NotFoundError extends CustomError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

/**
 * 409 Conflict — Use for duplicate records or resource state conflicts.
 */
export class ConflictError extends CustomError {
  constructor(message = "Resource already exists") {
    super(message, 409, "CONFLICT");
  }
}

/**
 * 415 Unsupported Media Type.
 */
export class UnsupportedMediaTypeError extends CustomError {
  constructor(message = "Unsupported media type") {
    super(message, 415, "UNSUPPORTED_MEDIA_TYPE");
  }
}

/**
 * 405 Method Not Allowed.
 */
export class MethodNotAllowedError extends CustomError {
  constructor(message = "Method not allowed") {
    super(message, 405, "METHOD_NOT_ALLOWED");
  }
}

/**
 * 304 Not Modified.
 */
export class NotModifiedError extends CustomError {
  constructor(message = "Resource not modified") {
    super(message, 304, "NOT_MODIFIED");
  }
}

/**
 * 500 Internal Server Error — Specifically for database-related failures.
 */
export class DatabaseError extends CustomError {
  constructor(message = "Database operation failed", originalError = null) {
    super(message, 500, "DATABASE_ERROR");
    this.originalError = originalError;
  }
}

/**
 * Map Prisma error codes to standard errors.
 * @param {Object} prismaError - Prisma error object.
 * @returns {CustomError} A mapped error or generic DatabaseError.
 */
export function handlePrismaError(prismaError) {
  if (prismaError?.code === "P2002") {
    return new ConflictError("A record with this value already exists");
  }
  if (prismaError?.code === "P2025") {
    return new NotFoundError("Record not found");
  }
  return new DatabaseError(
    prismaError?.message || "Database operation failed",
    prismaError
  );
}

/**
 * Utility function to validate required fields in a data object.
 * @param {Object} data - The data object to validate.
 * @param {Array} requiredFields - Array of required field names.
 * @throws {ValidationError}
 */
export function validateRequiredFields(data, requiredFields) {
  for (const field of requiredFields) {
    if (
      data[field] === undefined ||
      data[field] === null ||
      (typeof data[field] === "string" && data[field].trim() === "")
    ) {
      throw new ValidationError(`${field} is required`, field);
    }
  }
}

/**
 * Utility function to validate required request parameters.
 * @param {Object} params - The request params object.
 * @param {Array} requiredParams - Array of required parameter names.
 * @throws {ValidationError}
 */
export function validateRequiredParams(params, requiredParams) {
  for (const param of requiredParams) {
    if (
      !params[param] ||
      (typeof params[param] === "string" && params[param].trim() === "")
    ) {
      throw new ValidationError(`${param} parameter is required`, param);
    }
  }
}
