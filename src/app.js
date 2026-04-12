import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// 1. Import Shared Foundations
import { ApiResponse } from "./utils/responseHandler.js";
import { NotFoundError } from "./utils/Errors.js";
import errorHandler from "./middlewares/errorHandler.js";

// 2. Import Module Routes
import authRoutes from "./routes/v1/auth/auth.routes.js";

const app = express();

// 3. Base Middlewares
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: "http://localhost:3000", // Next.js frontend
    credentials: true,
  }),
);

// 4. Register Module Routes
// Every route inside authRoutes will now start with /api/v1/auth
app.use("/api/v1/auth", authRoutes);

// 5. Test Routes (To verify our Foundation works)
app.get("/api/health", (req, res) => {
  return ApiResponse.send(res, { 
    status: "UP", 
    message: "Foundry LMS Server is running 🚀" 
  });
});

app.get("/api/error-test", (req, res) => {
  throw new NotFoundError("Foundry LMS Foundation is working! This error was caught by our Global Error Handler.");
});

// 6. Global Error Handler (CRITICAL: Must be at the very bottom)
app.use(errorHandler);

export default app;
