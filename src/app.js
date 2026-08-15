import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { checkDatabaseReadiness } from "./utils/prisma.js";
import { checkEmailReadiness } from "./utils/email.js";
import { checkRateLimitStoreReadiness } from "./config/rateLimitStore.js";
import Logger from "./utils/logger.js";

// 1. Import Shared Foundations
import { ApiResponse } from "./utils/responseHandler.js";
import errorHandler from "./middlewares/errorHandler.js";

// 2. Import Module Routes
import authRoutes from "./routes/v1/auth/auth.routes.js";
import userRoutes from "./routes/v1/users/user.routes.js";
import catalogRoutes from "./routes/v1/catalog/catalog.routes.js";
import categoryRoutes from "./routes/v1/catalog/category.routes.js";
import courseRoutes from "./routes/v1/catalog/course.routes.js";
import learningServiceRoutes from "./routes/v1/catalog/learningService.routes.js";
import sessionLibraryRoutes from "./routes/v1/sessions/sessionLibrary.routes.js";
import batchRoutes from "./routes/v1/batches/batch.routes.js";
import certificateRoutes from "./routes/v1/enrollments/certificate.routes.js";
import enrollmentRoutes from "./routes/v1/enrollments/enrollment.routes.js";
import projectRoutes from "./routes/v1/projects/project.routes.js";
import auditRoutes from "./routes/v1/audit/audit.routes.js";
import apiArtifactRoutes from "./routes/v1/system/apiArtifact.routes.js";
import { requestContext } from "./middlewares/requestContext.js";

const app = express();
app.disable("x-powered-by");

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

// 3. Base Middlewares. Security and CORS run before body parsing so malformed
// requests receive the same protective headers as successful requests.
app.use(requestContext);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    strictTransportSecurity:
      process.env.NODE_ENV === "production" ? undefined : false,
  }),
);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// 4. Register Module Routes
app.use("/api/v1/auth", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/catalog", catalogRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/courses", courseRoutes);
app.use("/api/v1/services", learningServiceRoutes);
app.use("/api/v1/sessions", sessionLibraryRoutes);
app.use("/api/v1/batches", batchRoutes);
app.use("/api/v1/certificates", certificateRoutes);
app.use("/api/v1/enrollments", enrollmentRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/postman", apiArtifactRoutes);

// 5. Health Check
app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  return ApiResponse.send(res, {
    status: "UP",
    message: "Foundry LMS Server is running",
  });
});

app.get("/api/ready", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const checkSmtp =
    process.env.NODE_ENV === "production" ||
    process.env.READINESS_CHECK_SMTP === "true";
  try {
    const databaseCheck = checkDatabaseReadiness(2_000);
    const emailCheck = checkSmtp ? checkEmailReadiness() : Promise.resolve();
    const rateLimitStoreCheck = checkRateLimitStoreReadiness();
    const [, , rateLimitStore] = await Promise.all([
      databaseCheck,
      emailCheck,
      rateLimitStoreCheck,
    ]);
    return ApiResponse.send(res, {
      status: "READY",
      database: "UP",
      smtp: checkSmtp ? "UP" : "NOT_CHECKED",
      rateLimitStore,
    });
  } catch (error) {
    Logger.error("Dependency readiness check failed", error);
    return ApiResponse.send(
      res,
      {
        status: "NOT_READY",
        database: "UNKNOWN",
        smtp: checkSmtp ? "UNKNOWN" : "NOT_CHECKED",
        rateLimitStore: "UNKNOWN",
      },
      "Dependency readiness check failed",
      503,
    );
  }
});

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: "API route not found.",
    code: "ROUTE_NOT_FOUND",
    requestId: req.requestId,
  });
});

// 6. Global Error Handler (CRITICAL: Must be at the very bottom)
app.use(errorHandler);

export default app;
