import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/auth/auth.repository.js", () => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  findUserWithPassword: vi.fn(),
  findUserWithPasswordById: vi.fn(),
  createUser: vi.fn(),
  replaceUnverifiedUser: vi.fn(),
  replaceEmailOtp: vi.fn(),
  createLoginChallenge: vi.fn(),
  getRecentLoginChallengeActivity: vi.fn(),
  createPasswordResetToken: vi.fn(),
  changeUserPassword: vi.fn(),
}));
vi.mock("../../../utils/email.js", () => ({
  hasAuthEmailBudget: vi.fn(),
  sendLoginChallengeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendPasswordChangedEmail: vi.fn(),
  sendOtpEmail: vi.fn(),
}));
vi.mock("../../../utils/otp.js", () => ({
  generateOtp: vi.fn(() => ({ code: "123456", codeHash: "otp-hash", expiresAt: new Date(Date.now() + 600_000) })),
  hashOtpCandidates: vi.fn((code) => [`hash:${code}`]),
  hasValidMxRecord: vi.fn(async () => true),
}));

process.env.JWT_SECRET ||= "foundry-auth-service-test";

import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import * as email from "../../../utils/email.js";
import {
  changePasswordService,
  forgotPasswordService,
  loginService,
  registerService,
  resendOtpService,
} from "./auth.service.js";

const password = "Str0ngPassword!";
let passwordHash;

async function userFixture(overrides = {}) {
  passwordHash ??= await bcrypt.hash(password, 4);
  return {
    id: "90000000-0000-4000-8000-000000000001",
    email: "person@example.com",
    password: passwordHash,
    role: "STUDENT",
    securityVersion: 0,
    emailVerified: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  email.hasAuthEmailBudget.mockResolvedValue(true);
  email.sendLoginChallengeEmail.mockResolvedValue(undefined);
  email.sendPasswordResetEmail.mockResolvedValue(undefined);
  email.sendPasswordChangedEmail.mockResolvedValue(undefined);
  email.sendOtpEmail.mockResolvedValue(undefined);
  authRepo.getRecentLoginChallengeActivity.mockResolvedValue({ issued: 0, failedAttempts: 0 });
});

describe("administrator login (second factor)", () => {
  it("emails a code first, then issues the challenge", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ role: "ADMIN" }));
    authRepo.createLoginChallenge.mockResolvedValue({ id: "challenge-1", expiresAt: new Date() });

    const result = await loginService({ email: "person@example.com", password });

    expect(result).toMatchObject({ requiresMfa: true, challengeId: "challenge-1" });
    expect("token" in result).toBe(false);
    expect(email.hasAuthEmailBudget).toHaveBeenCalledWith("admin");
    const sentAt = email.sendLoginChallengeEmail.mock.invocationCallOrder[0];
    const storedAt = authRepo.createLoginChallenge.mock.invocationCallOrder[0];
    expect(sentAt).toBeLessThan(storedAt);
  });

  it("stops issuing codes after too many wrong guesses on the account", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ role: "SUPER_ADMIN" }));
    authRepo.getRecentLoginChallengeActivity.mockResolvedValue({ issued: 3, failedAttempts: 15 });

    await expect(loginService({ email: "person@example.com", password })).rejects.toThrow(TooManyRequestsError);
    expect(email.sendLoginChallengeEmail).not.toHaveBeenCalled();
    expect(authRepo.createLoginChallenge).not.toHaveBeenCalled();
  });

  it("stops issuing codes after too many challenges in the window", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ role: "ADMIN" }));
    authRepo.getRecentLoginChallengeActivity.mockResolvedValue({ issued: 10, failedAttempts: 0 });

    await expect(loginService({ email: "person@example.com", password })).rejects.toThrow(TooManyRequestsError);
  });

  it("answers 503 (not 500) when the code email can't be sent", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ role: "ADMIN" }));
    email.sendLoginChallengeEmail.mockRejectedValue(new Error("Resend down"));

    const error = await loginService({ email: "person@example.com", password }).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.statusCode).toBe(503);
    expect(authRepo.createLoginChallenge).not.toHaveBeenCalled();
  });

  it("answers 503 when the daily email quota is used up", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ role: "ADMIN" }));
    email.hasAuthEmailBudget.mockResolvedValue(false);

    await expect(loginService({ email: "person@example.com", password })).rejects.toThrow(ServiceUnavailableError);
    expect(email.sendLoginChallengeEmail).not.toHaveBeenCalled();
  });

  it("does not check the per-account cap for a wrong password", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(await userFixture({ role: "ADMIN" }));
    await expect(loginService({ email: "person@example.com", password: "nope-nope" })).rejects.toThrow(UnauthorizedError);
    expect(authRepo.getRecentLoginChallengeActivity).not.toHaveBeenCalled();
  });

  it("rejects an unknown email the same way as a wrong password", async () => {
    authRepo.findUserWithPassword.mockResolvedValue(null);
    const error = await loginService({ email: "nobody@example.com", password }).catch((e) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Invalid email or password.");
  });
});

describe("forgot password", () => {
  it("creates no token and sends nothing for an unknown email", async () => {
    authRepo.findUserByEmail.mockResolvedValue(null);
    await forgotPasswordService({ email: "nobody@example.com" });
    expect(authRepo.createPasswordResetToken).not.toHaveBeenCalled();
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("creates a token and emails the link for a known email", async () => {
    authRepo.findUserByEmail.mockResolvedValue(await userFixture());
    await forgotPasswordService({ email: "person@example.com" });
    expect(authRepo.createPasswordResetToken).toHaveBeenCalledTimes(1);
    expect(email.sendPasswordResetEmail).toHaveBeenCalledWith("person@example.com", expect.stringContaining("/reset-password?token="));
  });

  it("leaves existing reset links alone when the email budget is used up", async () => {
    authRepo.findUserByEmail.mockResolvedValue(await userFixture());
    email.hasAuthEmailBudget.mockResolvedValue(false);
    await forgotPasswordService({ email: "person@example.com" });
    expect(email.hasAuthEmailBudget).toHaveBeenCalledWith("public");
    expect(authRepo.createPasswordResetToken).not.toHaveBeenCalled();
  });
});

describe("resend verification code", () => {
  it("answers the same, silently, for an unknown email", async () => {
    authRepo.findUserByEmail.mockResolvedValue(null);
    await expect(resendOtpService({ email: "nobody@example.com" })).resolves.toBeUndefined();
    expect(email.sendOtpEmail).not.toHaveBeenCalled();
  });

  it("answers the same, silently, for an already-verified email", async () => {
    authRepo.findUserByEmail.mockResolvedValue(await userFixture({ emailVerified: true }));
    await expect(resendOtpService({ email: "person@example.com" })).resolves.toBeUndefined();
    expect(email.sendOtpEmail).not.toHaveBeenCalled();
  });

  it("sends the new code before replacing the old one", async () => {
    authRepo.findUserByEmail.mockResolvedValue(await userFixture({ emailVerified: false }));
    await resendOtpService({ email: "person@example.com" });
    const sentAt = email.sendOtpEmail.mock.invocationCallOrder[0];
    const replacedAt = authRepo.replaceEmailOtp.mock.invocationCallOrder[0];
    expect(sentAt).toBeLessThan(replacedAt);
  });

  it("keeps the old code valid when the email fails", async () => {
    authRepo.findUserByEmail.mockResolvedValue(await userFixture({ emailVerified: false }));
    email.sendOtpEmail.mockRejectedValue(new Error("Resend down"));
    await expect(resendOtpService({ email: "person@example.com" })).rejects.toThrow(ServiceUnavailableError);
    expect(authRepo.replaceEmailOtp).not.toHaveBeenCalled();
  });

  it("refuses up front when the email budget is used up", async () => {
    email.hasAuthEmailBudget.mockResolvedValue(false);
    await expect(resendOtpService({ email: "person@example.com" })).rejects.toThrow(ServiceUnavailableError);
    expect(authRepo.findUserByEmail).not.toHaveBeenCalled();
  });
});

describe("registration", () => {
  const signUp = {
    firstName: "Nimal",
    lastName: "Perera",
    email: "person@example.com",
    password,
    phone: "0771234567",
    address: "12 Main Street",
    district: "Colombo",
    dateOfBirth: "2000-01-01",
    alStream: "Science",
  };

  it("refuses an address that already has a verified account", async () => {
    authRepo.findUserByEmail.mockResolvedValue(await userFixture({ emailVerified: true }));
    await expect(registerService(signUp)).rejects.toThrow(ConflictError);
    expect(authRepo.createUser).not.toHaveBeenCalled();
    expect(authRepo.replaceUnverifiedUser).not.toHaveBeenCalled();
  });

  it("replaces the details of a never-verified account with the same address", async () => {
    const existing = await userFixture({ emailVerified: false });
    authRepo.findUserByEmail.mockResolvedValue(existing);
    authRepo.replaceUnverifiedUser.mockResolvedValue({ ...existing, firstName: "Nimal" });

    const result = await registerService(signUp);

    expect(authRepo.replaceUnverifiedUser).toHaveBeenCalledWith(existing.id, expect.objectContaining({ firstName: "Nimal" }));
    expect(authRepo.createUser).not.toHaveBeenCalled();
    expect(result.verificationEmailSent).toBe(true);
  });

  it("refuses names containing markup", async () => {
    await expect(registerService({ ...signUp, firstName: "<a href=x>Pay</a>" })).rejects.toThrow(ValidationError);
  });

  it("creates the account but reports no email when the budget is used up", async () => {
    authRepo.findUserByEmail.mockResolvedValue(null);
    authRepo.createUser.mockResolvedValue(await userFixture({ emailVerified: false }));
    email.hasAuthEmailBudget.mockResolvedValue(false);

    const result = await registerService(signUp);
    expect(result.verificationEmailSent).toBe(false);
    expect(email.sendOtpEmail).not.toHaveBeenCalled();
  });
});

describe("change password", () => {
  it("rejects a wrong current password", async () => {
    authRepo.findUserWithPasswordById.mockResolvedValue(await userFixture());
    const error = await changePasswordService("u-1", { currentPassword: "wrong-pass", newPassword: "N3wPassword!" }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.field).toBe("currentPassword");
    expect(authRepo.changeUserPassword).not.toHaveBeenCalled();
  });

  it("changes the password and returns a fresh session token", async () => {
    const user = await userFixture();
    authRepo.findUserWithPasswordById.mockResolvedValue(user);
    authRepo.changeUserPassword.mockResolvedValue({ id: user.id, email: user.email, role: "STUDENT", securityVersion: 1 });
    authRepo.findUserById.mockResolvedValue({ ...user, securityVersion: 1 });

    const result = await changePasswordService(user.id, { currentPassword: password, newPassword: "N3wPassword!" });

    expect(authRepo.changeUserPassword).toHaveBeenCalledWith(user.id, expect.any(String));
    expect(typeof result.token).toBe("string");
    expect(result.user.email).toBe(user.email);
  });
});
