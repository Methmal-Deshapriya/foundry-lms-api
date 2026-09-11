import { afterEach, describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./runtimeConfig.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("runtime configuration", () => {
  it("accepts the required security and public-origin values", () => {
    process.env.JWT_SECRET = "test-secret-with-at-least-32-bytes";
    process.env.CLIENT_URL = "https://academy.example";
    process.env.CORS_ORIGIN = "https://academy.example";
    expect(() => validateRuntimeConfig()).not.toThrow();
  });

  it("fails startup when the certificate public origin is missing", () => {
    process.env.JWT_SECRET = "test-secret-with-at-least-32-bytes";
    process.env.CORS_ORIGIN = "https://academy.example";
    delete process.env.CLIENT_URL;
    expect(() => validateRuntimeConfig()).toThrow(/CLIENT_URL is required/);
  });

  it("requires SMTP, OTP, and explicit Accelerate timeout configuration in production", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "test-secret-with-at-least-32-bytes";
    process.env.CLIENT_URL = "https://academy.example";
    process.env.CORS_ORIGIN = "https://academy.example";
    process.env.PROJECT_THUMBNAIL_HOSTS = "cdn.example";
    process.env.DATABASE_URL = "prisma+postgres://accelerate.example/key";
    delete process.env.SMTP_HOST;

    expect(() => validateRuntimeConfig()).toThrow(/SMTP_HOST is required/i);
  });

  it("keeps Prisma's transaction deadline below the database idle deadline", () => {
    process.env.JWT_SECRET = "test-secret-with-at-least-32-bytes";
    process.env.CLIENT_URL = "https://academy.example";
    process.env.CORS_ORIGIN = "https://academy.example";
    process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS = "10000";
    process.env.DB_INTERACTIVE_TRANSACTION_TIMEOUT_MS = "10000";

    expect(() => validateRuntimeConfig()).toThrow(
      /DB_INTERACTIVE_TRANSACTION_TIMEOUT_MS.*lower/i,
    );
  });
});
