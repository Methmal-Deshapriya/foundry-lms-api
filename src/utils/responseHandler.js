/**
 * Standard response handler for Foundry LMS
 */
export const ApiResponse = {
  /**
   * Format a success response object
   * @param {any} data - Response data
   * @param {string} message - Success message
   * @returns {object} Formatted success response
   */
  success: (data = null, message = "Success") => {
    const response = {
      success: true,
    };

    if (data !== null && data !== undefined) {
      response.data = data;
    }

    if (message) {
      response.message = message;
    }

    return response;
  },

  /**
   * Generate an error response object
   * @param {string} message - Error message
   * @param {string|object} [code="ERROR"] - Error code or error details object
   * @returns {object} Formatted error response
   */
  error: (message, code = "ERROR") => {
    const normalizedCode =
      typeof code === "string" ? code : code?.error || "ERROR";

    const response = {
      success: false,
      error: message || "An error occurred",
    };

    if (normalizedCode) {
      response.code = normalizedCode;
    }

    return response;
  },

  /**
   * Send a formatted API response directly through Express res object
   * @param {object} res - Express response object
   * @param {object|null} data - Response data
   * @param {object|null} error - Error object { code: string, message: string, statusCode: number, field: string, details: any }
   * @param {number} [statusCode] - HTTP status code (optional override)
   */
  send: (res, data = null, error = null, statusCode) => {
    const response = {
      success: !error,
    };

    // Success data
    if (!error && data !== undefined && data !== null) {
      response.data = data;
    }

    // Success message can also be passed in data if needed, or extracted
    if (!error && data?.message) {
      response.message = data.message;
    }

    // Error data
    if (error) {
      response.error = error.message || "An error occurred";

      if (error.code) {
        response.code = error.code;
      }

      if (error.field != null) {
        response.field = error.field;
      }
      if (error.details != null) {
        response.details = error.details;
      }
    }

    // Status code resolution
    const hasExplicitStatusCode =
      Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599;
    const errorStatusCode = Number.isInteger(error?.statusCode)
      ? error.statusCode
      : null;
    const errorStatus = Number.isInteger(error?.status) ? error.status : null;

    const finalStatusCode = error
      ? hasExplicitStatusCode
        ? statusCode
        : errorStatusCode || errorStatus || 500
      : hasExplicitStatusCode
      ? statusCode
      : 200;

    res.status(finalStatusCode).json(response);
  },
};

export default ApiResponse;
