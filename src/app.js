import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// 1. Import Shared Foundations
import { ApiResponse } from "./utils/responseHandler.js";
import { NotFoundError } from "./utils/Errors.js";
import errorHandler from "./middlewares/errorHandler.js";

// 2. Import Module Routes
import authRoutes from "./routes/v1/auth/auth.routes.js";
import userRoutes from "./routes/v1/users/user.routes.js";
import bootcampRoutes from "./routes/v1/bootcamps/bootcamp.routes.js";
import enrollmentRoutes from "./routes/v1/enrollments/enrollment.routes.js";
import auditRoutes from "./routes/v1/audit/audit.routes.js";

const app = express();

// 3. Base Middlewares
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: "http://localhost:3001", // Next.js frontend
    credentials: true,
  }),
);

// 4. Register Module Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/bootcamps", bootcampRoutes);
app.use("/api/v1/enrollments", enrollmentRoutes);
app.use("/api/v1/audit", auditRoutes);

// 5. Test Routes (To verify our Foundation works)
app.get("/api/health", (req, res) => {
  return ApiResponse.send(res, {
    status: "UP",
    message: "Foundry LMS Server is running 🚀",
  });
});

app.get("/api/error-test", (req, res) => {
  throw new NotFoundError(
    "Foundry LMS Foundation is working! This error was caught by our Global Error Handler.",
  );
});

// 6. Global Error Handler (CRITICAL: Must be at the very bottom)
app.use(errorHandler);

export default app;
