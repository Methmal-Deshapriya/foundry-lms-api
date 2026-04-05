import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();

// Middlewares
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: "http://localhost:3000", // Next.js frontend
    credentials: true,
  }),
);

// Test route
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running 🚀",
  });
});

export default app;
