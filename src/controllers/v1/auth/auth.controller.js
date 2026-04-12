import * as authService from "../../../services/v1/auth/auth.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Auth Controller - The "Front Desk"
 * Handles HTTP requests and responses for authentication.
 */

// Common cookie options for both register, login, and logout
const cookieOptions = {
  httpOnly: true, // Prevents JavaScript from reading the cookie
  secure: process.env.NODE_ENV === "production", // Only sent over HTTPS in production
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  sameSite: "strict", // Protects against CSRF attacks
};

/**
 * Controller: Register a new user.
 * POST /v1/auth/register
 */
export async function registerController(req, res, next) {
  try {
    const { user, token } = await authService.registerService(req.body);

    // Set the secure cookie
    res.cookie("token", token, cookieOptions);

    return ApiResponse.send(res, user, "Registration successful", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Log in a user.
 * POST /v1/auth/login
 */
export async function loginController(req, res, next) {
  try {
    const { user, token } = await authService.loginService(req.body);

    // Set the secure cookie
    res.cookie("token", token, cookieOptions);

    return ApiResponse.send(res, user, "Login successful");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Log out a user.
 * POST /v1/auth/logout
 */
export async function logoutController(req, res, next) {
  try {
    // 1. Clear the authentication cookie
    res.clearCookie("token", cookieOptions);

    // 2. Return a success response
    return ApiResponse.send(res, null, "Logout successful");
  } catch (error) {
    next(error);
  }
}
