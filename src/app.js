import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

// 1. Import Shared Foundations
import { ApiResponse } from "./utils/responseHandler.js";
import errorHandler from "./middlewares/errorHandler.js";

// 2. Import Module Routes
import authRoutes from "./routes/v1/auth/auth.routes.js";
import userRoutes from "./routes/v1/users/user.routes.js";
import catalogRoutes from "./routes/v1/catalog/catalog.routes.js";
import categoryRoutes from "./routes/v1/catalog/category.routes.js";
import courseRoutes from "./routes/v1/catalog/course.routes.js";
import sessionLibraryRoutes from "./routes/v1/sessions/sessionLibrary.routes.js";
import batchRoutes from "./routes/v1/batches/batch.routes.js";
import certificateRoutes from "./routes/v1/enrollments/certificate.routes.js";
import enrollmentRoutes from "./routes/v1/enrollments/enrollment.routes.js";
import projectRoutes from "./routes/v1/projects/project.routes.js";
import auditRoutes from "./routes/v1/audit/audit.routes.js";
import apiArtifactRoutes from "./routes/v1/system/apiArtifact.routes.js";

const app = express();

// 3. Base Middlewares
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  }),
);

// 4. Register Module Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/catalog", catalogRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/courses", courseRoutes);
app.use("/api/v1/sessions", sessionLibraryRoutes);
app.use("/api/v1/batches", batchRoutes);
app.use("/api/v1/certificates", certificateRoutes);
app.use("/api/v1/enrollments", enrollmentRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/postman", apiArtifactRoutes);

// 5. Health Check
app.get("/api/health", (req, res) => {
  return ApiResponse.send(res, {
    status: "UP",
    message: "Foundry LMS Server is running 🚀",
  });
});

// 6. Global Error Handler (CRITICAL: Must be at the very bottom)
app.use(errorHandler);

export default app;
