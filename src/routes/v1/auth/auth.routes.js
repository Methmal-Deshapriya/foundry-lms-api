import express from "express";
import * as authController from "../../../controllers/v1/auth/auth.controller.js";

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

export default router;
