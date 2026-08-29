import * as authService from "../../../services/v1/auth/auth.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";
import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  getAuthCookieOptions,
} from "../../../config/authCookie.js";

/**
 * Auth Controller - The "Front Desk"
 * Handles HTTP requests and responses for authentication.
 */

/**
 * Controller: Register a new user.
 * POST /v1/auth/register
 */
export async function registerController(req, res, next) {
  try {
    // Registering does NOT log the user in — no cookie is set here.
    // They must verify their email via OTP first (see verifyOtpController).
    const user = await authService.registerService(req.body);
    const message = user.verificationEmailSent
      ? "Registration successful. Please check your email for a verification code."
      : "Your account was created, but the verification email could not be delivered. Use resend verification when email service is available.";

    return ApiResponse.send(
      res,
      user,
      message,
      201
    );
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
    const result = await authService.loginService(req.body);

    if (result.requiresMfa) {
      return ApiResponse.send(
        res,
        result,
        "A verification code was sent to your administrator email.",
      );
    }

    const { user, token } = result;

    // Set the secure cookie
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

    return ApiResponse.send(res, user, "Login successful");
  } catch (error) {
    next(error);
  }
}

export async function verifyLoginChallengeController(req, res, next) {
  try {
    const { user, token } = await authService.verifyLoginChallengeService(
      req.body,
    );
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
    return ApiResponse.send(res, user, "Administrator login successful.");
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
    // Invalidate the server-side session version before clearing this browser.
    // This makes logout immediate even if a copy of the JWT exists elsewhere.
    await authService.logoutService(req.user.id);
    clearAuthCookie(res);

    // 2. Return a success response
    return ApiResponse.send(res, { message: "Logout successful" });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Request a password reset email.
 * POST /v1/auth/forgot-password
 */
export async function forgotPasswordController(req, res, next) {
  try {
    await authService.forgotPasswordService(req.body);

    const message =
      "If that email is registered, a password reset link has been sent.";
    return ApiResponse.send(res, { message }, message);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Reset a password using a valid reset token.
 * POST /v1/auth/reset-password
 */
export async function resetPasswordController(req, res, next) {
  try {
    await authService.resetPasswordService(req.body);

    const message = "Password reset successful.";
    return ApiResponse.send(res, { message }, message);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Verify a newly registered email with an OTP code.
 * This is the actual login moment — sets the auth cookie on success.
 * POST /v1/auth/verify-otp
 */
export async function verifyOtpController(req, res, next) {
  try {
    const { user, token } = await authService.verifyOtpService(req.body);

    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());

    return ApiResponse.send(res, user, "Email verified successfully.");
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Resend a fresh OTP code to a not-yet-verified user.
 * POST /v1/auth/resend-otp
 */
export async function resendOtpController(req, res, next) {
  try {
    await authService.resendOtpService(req.body);

    const message = "A new verification code has been sent to your email.";
    return ApiResponse.send(res, { message }, message);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller: Get the current authenticated user's profile.
 * GET /v1/auth/me
 */
export async function getMeController(req, res, next) {
  try {
    // 1. Ask the service for the user profile using the ID from the authenticate middleware
    const user = await authService.getMeService(req.user.id);

    // 2. Return a success response
    return ApiResponse.send(res, user, "User profile fetched successfully");
  } catch (error) {
    if (error?.statusCode === 404) clearAuthCookie(res);
    next(error);
  }
}

