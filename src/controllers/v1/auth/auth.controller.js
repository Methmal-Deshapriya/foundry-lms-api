import * as authService from "../../../services/v1/auth/auth.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Auth Controller - The "Front Desk"
 * Handles HTTP requests and responses for authentication.
 */

/**
 * Register a new user.
 * POST /v1/auth/register
 */
export async function registerController(req, res, next) {
  try {
    // 1. Call the Service to handle the business logic (Validation, Hashing, Saving)
    const { user, token } = await authService.registerUser(req.body);

    // 2. Set the HTTP-only cookie for the authentication token
    // This is more secure than sending it in the response body.
    res.cookie("token", token, {
      httpOnly: true, // Prevents JavaScript from reading the cookie
      secure: process.env.NODE_ENV === "production", // Only sent over HTTPS in production
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: "strict", // Protects against CSRF attacks
    });

    // 3. Return a success response with the sanitized user data
    return ApiResponse.send(
      res,
      user,
      null,
      201, // 201 Created is the standard for successful registration
    );
  } catch (error) {
    // Pass any errors (Validation, Conflict, etc.) to the Global Error Handler
    next(error);
  }
}
