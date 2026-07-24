import express from "express";
import rateLimit from "express-rate-limit";
import * as authController from "../../../controllers/v1/auth/auth.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";

/**
 * Auth Routes - The "Sign on the Door"
 * Maps HTTP addresses to Auth Controller actions.
 */

const router = express.Router();

// Scoped to /forgot-password only — this endpoint sends real email to
// arbitrary addresses, so it needs its own abuse guard.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many reset requests. Please try again later.",
    code: "TOO_MANY_REQUESTS",
  },
});

/**
 * @route   POST /v1/auth/register
 * @desc    Register a new user account
 * @access  Public
 */
router.post("/register", authController.registerController);

/**
 * @route   POST /v1/auth/login
 * @desc    Log in a user
 * @access  Public
 */
router.post("/login", authController.loginController);

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
router.post("/reset-password", authController.resetPasswordController);

export default router;
