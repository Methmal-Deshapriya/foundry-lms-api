import { afterEach, describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./runtimeConfig.js";

const original = {
  jwtSecret: process.env.JWT_SECRET,
  clientUrl: process.env.CLIENT_URL,
};

afterEach(() => {
  if (original.jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = original.jwtSecret;
  if (original.clientUrl === undefined) delete process.env.CLIENT_URL;
  else process.env.CLIENT_URL = original.clientUrl;
});

describe("runtime configuration", () => {
  it("accepts the required security and public-origin values", () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.CLIENT_URL = "https://academy.example";
    expect(() => validateRuntimeConfig()).not.toThrow();
  });

  it("fails startup when the certificate public origin is missing", () => {
    process.env.JWT_SECRET = "test-secret";
    delete process.env.CLIENT_URL;
    expect(() => validateRuntimeConfig()).toThrow(/CLIENT_URL is required/);
  });
});
