import Logger from "../utils/logger.js";
import { ApiResponse } from "../utils/responseHandler.js";
import { CustomError } from "../utils/Errors.js";

/**
 * Global Error Handling Middleware - The "Safety Net"
 * Catches all errors from across the app and sends a consistent response.
 * 
 * NOTE: Express knows this is an error handler because it has 4 arguments.
 */
const firstLine = (message) => String(message ?? "").split("\n").find((line) => line.trim())?.trim().slice(0, 300) ?? "";

const errorHandler = (err, req, res, next) => {
  // 1. Log the error for the developer to see in the terminal. `originalError`
  // (set by handlePrismaError) carries the real, unsanitized failure detail
  // for errors whose public-facing message is deliberately generic.
  const diagnosticError = err.originalError || err;
  // Only the first line of the message: a Prisma validation error renders
  // the whole query call, argument values included (code review M10-09).
  Logger.error(`${req.method} ${req.path} - Error: ${firstLine(diagnosticError.message)}`, {
    requestId: req.requestId,
    errorName: diagnosticError.name,
    errorCode: typeof diagnosticError.code === "string" ? diagnosticError.code : null,
    stack: diagnosticError.stack, // The "map" to where the error happened in code
  });

  // 2. Determine if this is a "Known" (Custom) error or an "Unknown" (System) error.
  let errorResponse = {
    message: err.message || "An unexpected error occurred",
    statusCode: err.statusCode || 500,
    code: err.code || "INTERNAL_SERVER_ERROR",
    field: err.field || null,
    details: err.details || null,
  };

  // An oversized body is the client's problem, said plainly (M10-08).
  if (err?.type === "entity.too.large") {
    errorResponse = {
      message: "The request is too large.",
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      field: null,
      details: null,
    };
  }

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
  if (!(err instanceof CustomError) && !["entity.parse.failed", "entity.too.large"].includes(err?.type)) {
    // If it's a generic error (like a typo), we hide the details from the user for security.
    // Nothing from an unknown error reaches the client: not its message,
    // field, details or its own status code (code review M10-08).
    errorResponse.message = "Internal Server Error";
    errorResponse.code = "INTERNAL_SERVER_ERROR";
    errorResponse.statusCode = 500;
    errorResponse.field = null;
    errorResponse.details = null;
    
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
