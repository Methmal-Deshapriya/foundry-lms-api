import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, UnauthorizedError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/auth/auth.repository.js", () => ({
  findUserWithPassword: vi.fn(),
  createLoginChallenge: vi.fn(),
}));
vi.mock("../../../utils/email.js", () => ({
  sendLoginChallengeEmail: vi.fn(),
}));

process.env.JWT_SECRET ||= "foundry-auth-service-test";

import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import { loginService } from "./auth.service.js";

const password = "Str0ngPassword!";

async function studentFixture(overrides = {}) {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    email: "student@example.com",
    password: await bcrypt.hash(password, 4),
    role: "STUDENT",
    securityVersion: 0,
    emailVerified: false,
    ...overrides,
  };
}

describe("loginService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks login until the account's email is verified", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await studentFixture({ emailVerified: false }));

    const error = await loginService({ email: "student@example.com", password }).catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("logs in a verified student normally", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await studentFixture({ emailVerified: true }));

    const result = await loginService({ email: "student@example.com", password });

    expect("requiresMfa" in result).toBe(false);
    if (!("requiresMfa" in result)) {
      expect(result.user.emailVerified).toBe(true);
      expect(typeof result.token).toBe("string");
    }
  });

  it("still rejects a wrong password regardless of verification status", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await studentFixture());

    await expect(
      loginService({ email: "student@example.com", password: "wrong-password" }),
    ).rejects.toThrow(UnauthorizedError);
  });
});
