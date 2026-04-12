import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// 1. Import Shared Foundations
import { ApiResponse } from "./utils/responseHandler.js";
import { NotFoundError } from "./utils/Errors.js";
import errorHandler from "./middlewares/errorHandler.js";

const app = express();

// 2. Base Middlewares
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: "http://localhost:3000", // Next.js frontend
    credentials: true,
  }),
);

// 3. Test Routes (To verify our Foundation works)

// Success Test: Uses our new ApiResponse utility
app.get("/api/health", (req, res) => {
  return ApiResponse.send(res, { 
    status: "UP", 
    message: "Foundry LMS Server is running 🚀" 
  });
});

// Error Test: Throws a custom error to see if our errorHandler catches it
app.get("/api/error-test", (req, res) => {
  throw new NotFoundError("Foundry LMS Foundation is working! This error was caught by our Global Error Handler.");
});

// 4. Global Error Handler (CRITICAL: Must be at the very bottom)
app.use(errorHandler);

export default app;
