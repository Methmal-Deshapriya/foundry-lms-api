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
   * Send a formatted success response directly through Express res object.
   * @param {object} res - Express response object
   * @param {object|null} data - Response data
   * @param {string|null} [message] - Optional success message
   * @param {number} [statusCode] - HTTP status code (optional override)
   */
  send: (res, data = null, message = null, statusCode) => {
    const hasExplicitStatusCode =
      Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599;
    const finalStatusCode = hasExplicitStatusCode ? statusCode : 200;
    const finalMessage = message ?? data?.message ?? "Success";

    res.status(finalStatusCode).json(ApiResponse.success(data, finalMessage));
  },
};

export default ApiResponse;
