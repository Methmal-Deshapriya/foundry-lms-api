import Logger from "../utils/logger.js";
import { ApiResponse } from "../utils/responseHandler.js";
import { CustomError } from "../utils/Errors.js";

/**
 * Global Error Handling Middleware - The "Safety Net"
 * Catches all errors from across the app and sends a consistent response.
 * 
 * NOTE: Express knows this is an error handler because it has 4 arguments.
 */
const errorHandler = (err, req, res, next) => {
  // 1. Log the error for the developer to see in the terminal. `originalError`
  // (set by handlePrismaError) carries the real, unsanitized failure detail
  // for errors whose public-facing message is deliberately generic.
  const diagnosticError = err.originalError || err;
  Logger.error(`${req.method} ${req.url} - Error: ${diagnosticError.message}`, {
    requestId: req.requestId,
    stack: diagnosticError.stack, // The "map" to where the error happened in code
    details: err.details || null,
  });

  // 2. Determine if this is a "Known" (Custom) error or an "Unknown" (System) error.
  let errorResponse = {
    message: err.message || "An unexpected error occurred",
    statusCode: err.statusCode || 500,
    code: err.code || "INTERNAL_SERVER_ERROR",
    field: err.field || null,
    details: err.details || null,
  };

  if (err?.type === "entity.parse.failed" && err?.status === 400) {
    errorResponse = {
      message: "Request body contains malformed JSON.",
      statusCode: 400,
      code: "MALFORMED_JSON",
      field: null,
      details: null,
    };
  }

  // 3. Handle specific non-CustomError cases (like standard JS Errors)
  if (!(err instanceof CustomError) && err?.type !== "entity.parse.failed") {
    // If it's a generic error (like a typo), we hide the details from the user for security.
    errorResponse.message = "Internal Server Error";
    errorResponse.code = "INTERNAL_SERVER_ERROR";
    
    // In development mode, we can show more info to help the developer.
    if (process.env.NODE_ENV === "development") {
      errorResponse.message = err.message;
      errorResponse.details = err.stack;
    }
  }

  // 4. Send the final client-facing error response.
  return res.status(errorResponse.statusCode).json({
    success: false,
    error: errorResponse.message,
    code: errorResponse.code,
    requestId: req.requestId,
    ...(errorResponse.field != null ? { field: errorResponse.field } : {}),
    ...(errorResponse.details != null ? { details: errorResponse.details } : {}),
  });
};

export default errorHandler;
