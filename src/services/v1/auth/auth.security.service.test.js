import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/auth/auth.repository.js", () => ({
  findUserWithPassword: vi.fn(),
  findUserWithPasswordById: vi.fn(),
  findUserById: vi.fn(),
  verifyLoginChallenge: vi.fn(),
  verifyEmailWithOtp: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  changeUserPassword: vi.fn(),
}));
vi.mock("../../../utils/email.js", () => ({
  hasAuthEmailBudget: vi.fn(async () => false),
  sendLoginChallengeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendPasswordChangedEmail: vi.fn(async () => undefined),
  sendOtpEmail: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

process.env.JWT_SECRET ||= "foundry-auth-security-test";

import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import { recordActionService } from "../audit/audit.service.js";
import { changePasswordService, loginService, resetPasswordService, verifyLoginChallengeService, verifyOtpService } from "./auth.service.js";

const password = "Str0ngPassword!";
const context = { requestId: "req-1", ip: "203.0.113.7" };
const userFixture = async (overrides = {}) => ({
  id: "90000000-0000-4000-8000-000000000001",
  email: "owner@example.com",
  password: await bcrypt.hash(password, 4),
  role: "STUDENT",
  securityVersion: 0,
  emailVerified: true,
  disabledAt: null,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("suspended accounts can't sign in (M10-05)", () => {
  it("refuses a password login once the password matched", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ disabledAt: new Date() }));
    await expect(loginService({ email: "owner@example.com", password }, context)).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });

  it("still answers a wrong password the usual way", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ disabledAt: new Date() }));
    await expect(loginService({ email: "owner@example.com", password: "wrong-password" }, context)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses the administrator code step", async () => {
    authRepo.verifyLoginChallenge.mockResolvedValue(await userFixture({ role: "SUPER_ADMIN", disabledAt: new Date() }));
    await expect(verifyLoginChallengeService({ challengeId: "c0000000-0000-4000-8000-000000000001", code: "123456" }, context)).rejects.toMatchObject({
      code: "ACCOUNT_SUSPENDED",
    });
  });

  it("refuses the email-verification sign-in", async () => {
    authRepo.verifyEmailWithOtp.mockResolvedValue(await userFixture({ disabledAt: new Date() }));
    await expect(verifyOtpService({ email: "owner@example.com", code: "123456" })).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });
});

describe("sign-in security events are audited (M10-07)", () => {
  const expectAudit = (action, userId) =>
    expect(recordActionService).toHaveBeenCalledWith(
      expect.objectContaining({ action, actorUserId: userId, entityId: userId, metadata: { requestId: "req-1", ip: "203.0.113.7" } }),
    );

  it("records an administrator sign-in", async () => {
    const admin = await userFixture({ role: "ADMIN" });
    authRepo.verifyLoginChallenge.mockResolvedValue(admin);
    await verifyLoginChallengeService({ challengeId: "c0000000-0000-4000-8000-000000000001", code: "123456" }, context);
    expectAudit("ADMIN_LOGIN", admin.id);
  });

  it("records a wrong administrator code, without the code", async () => {
    const error = new ValidationError("Incorrect code. Please try again.", "code");
    error.challengeUserId = "admin-1";
    authRepo.verifyLoginChallenge.mockRejectedValue(error);
    await expect(verifyLoginChallengeService({ challengeId: "c0000000-0000-4000-8000-000000000001", code: "123456" }, context)).rejects.toBe(error);
    expectAudit("ADMIN_LOGIN_OTP_FAILED", "admin-1");
    expect(JSON.stringify(recordActionService.mock.calls)).not.toContain("123456");
  });

  it("records a password reset and a password change", async () => {
    const user = await userFixture();
    authRepo.resetPasswordWithToken.mockResolvedValue(user);
    await resetPasswordService({ token: "a".repeat(64), newPassword: "An0ther-Str0ng-Pass!" }, context);
    expectAudit("PASSWORD_RESET", user.id);

    authRepo.findUserWithPasswordById.mockResolvedValue(user);
    authRepo.changeUserPassword.mockResolvedValue(user);
    authRepo.findUserById.mockResolvedValue(user);
    await changePasswordService(user.id, { currentPassword: password, newPassword: "An0ther-Str0ng-Pass!" }, context);
    expectAudit("PASSWORD_CHANGED", user.id);
  });
});
