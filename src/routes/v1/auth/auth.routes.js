import express from "express";
import * as authController from "../../../controllers/v1/auth/auth.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";
import {
  forgotPasswordLimiter,
  loginIpLimiter,
  loginLimiter,
  loginMfaVerificationLimiter,
  otpVerificationLimiter,
  passwordResetLimiter,
  registrationLimiter,
  resendOtpLimiter,
} from "../../../middlewares/rateLimiters.js";

/**
 * Auth Routes - The "Sign on the Door"
 * Maps HTTP addresses to Auth Controller actions.
 */

const router = express.Router();

// Scoped to /forgot-password only — this endpoint sends real email to
// arbitrary addresses, so it needs its own abuse guard.

// Scoped to /resend-otp only — same reasoning as forgotPasswordLimiter.

/**
 * @route   POST /v1/auth/register
 * @desc    Register a new user account
 * @access  Public
 */
router.post("/register", registrationLimiter, authController.registerController);

/**
 * @route   POST /v1/auth/login
 * @desc    Log in a user
 * @access  Public
 */
router.post(
  "/login",
  loginIpLimiter,
  loginLimiter,
  authController.loginController,
);

router.post(
  "/verify-login-challenge",
  loginMfaVerificationLimiter,
  authController.verifyLoginChallengeController,
);

/**
 * @route   POST /v1/auth/logout
 * @desc    Log out a user
 * @access  Public
 */
router.post("/logout", authController.logoutController);

/**
 * @route   GET /v1/auth/me
 * @desc    Get current authenticated user profile
 * @access  Private (Authenticated)
 */
router.get("/me", authenticate, authController.getMeController);

/**
 * @route   POST /v1/auth/forgot-password
 * @desc    Request a password reset email
 * @access  Public
 */
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  authController.forgotPasswordController
);

/**
 * @route   POST /v1/auth/reset-password
 * @desc    Reset a password using a valid reset token
 * @access  Public
 */
router.post(
  "/reset-password",
  passwordResetLimiter,
  authController.resetPasswordController,
);

/**
 * @route   POST /v1/auth/verify-otp
 * @desc    Verify a newly registered email with an OTP code (logs the user in)
 * @access  Public
 */
router.post(
  "/verify-otp",
  otpVerificationLimiter,
  authController.verifyOtpController,
);

/**
 * @route   POST /v1/auth/resend-otp
 * @desc    Resend a fresh OTP code to a not-yet-verified user
 * @access  Public
 */
router.post("/resend-otp", resendOtpLimiter, authController.resendOtpController);

export default router;
