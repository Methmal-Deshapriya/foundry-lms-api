import express from "express";
import * as authController from "../../../controllers/v1/auth/auth.controller.js";
import { authenticate } from "../../../middlewares/authenticate.js";

/**
 * Auth Routes - The "Sign on the Door"
 * Maps HTTP addresses to Auth Controller actions.
 */

const router = express.Router();

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

export default router;
