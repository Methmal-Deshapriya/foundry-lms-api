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
  // 1. Log the error for the developer to see in the terminal
  Logger.error(`${req.method} ${req.url} - Error: ${err.message}`, {
    stack: err.stack, // The "map" to where the error happened in code
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

  // 3. Handle specific non-CustomError cases (like standard JS Errors)
  if (!(err instanceof CustomError)) {
    // If it's a generic error (like a typo), we hide the details from the user for security.
    errorResponse.message = "Internal Server Error";
    errorResponse.code = "INTERNAL_SERVER_ERROR";
    
    // In development mode, we can show more info to help the developer.
    if (process.env.NODE_ENV === "development") {
      errorResponse.message = err.message;
      errorResponse.details = err.stack;
    }
  }

  // 4. Send the professional JSON response using our Response Utility.
  return ApiResponse.send(res, null, errorResponse, errorResponse.statusCode);
};

export default errorHandler;
