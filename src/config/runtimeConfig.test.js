import { afterEach, describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./runtimeConfig.js";

const original = {
  jwtSecret: process.env.JWT_SECRET,
  clientUrl: process.env.CLIENT_URL,
  corsOrigin: process.env.CORS_ORIGIN,
};

afterEach(() => {
  if (original.jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original.jwtSecret;
  if (original.clientUrl === undefined) delete process.env.CLIENT_URL;
  else process.env.CLIENT_URL = original.clientUrl;
  if (original.corsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = original.corsOrigin;
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
});
