import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    passwordResetToken: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { update: vi.fn(), findUnique: vi.fn() },
    emailOtp: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  return {
    transaction,
    prisma: { $transaction: vi.fn(async (callback) => callback(transaction)) },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { resetPasswordWithToken, verifyEmailWithOtp } from "./auth.repository.js";

describe("auth repository transactional security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("consumes reset token, bumps the session version, and invalidates siblings", async () => {
    mocks.transaction.passwordResetToken.findFirst
      .mockResolvedValueOnce({ id: "reset-1", userId: "user-1" })
      .mockResolvedValueOnce({ id: "reset-1", userId: "user-1" });
    mocks.transaction.passwordResetToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });
    mocks.transaction.user.update.mockResolvedValue({
      id: "user-1",
      email: "student@example.com",
      securityVersion: 2,
    });

    await resetPasswordWithToken("hash", "new-hash");

    expect(mocks.transaction.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { password: "new-hash", securityVersion: { increment: 1 } },
      select: { id: true, email: true, securityVersion: true },
    });
    expect(mocks.transaction.passwordResetToken.updateMany).toHaveBeenLastCalledWith({
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("rejects a concurrently consumed reset token", async () => {
    mocks.transaction.passwordResetToken.findFirst
      .mockResolvedValueOnce({ id: "reset-1", userId: "user-1" })
      .mockResolvedValueOnce({ id: "reset-1", userId: "user-1" });
    mocks.transaction.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(resetPasswordWithToken("hash", "new-hash")).rejects.toMatchObject({
      code: "RESET_TOKEN_ALREADY_USED",
    });
    expect(mocks.transaction.user.update).not.toHaveBeenCalled();
  });

  it("verifies an OTP and the user atomically", async () => {
    mocks.transaction.user.findUnique
      .mockResolvedValueOnce({ id: "user-1" })
      .mockResolvedValueOnce({ id: "user-1", emailVerified: false });
    mocks.transaction.emailOtp.findFirst.mockResolvedValue({
      id: "otp-1",
      attempts: 0,
      codeHash: "correct",
    });
    mocks.transaction.emailOtp.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.user.update.mockResolvedValue({
      id: "user-1",
      emailVerified: true,
    });

    const user = await verifyEmailWithOtp("student@example.com", ["correct"], 5);
    expect(user.emailVerified).toBe(true);
    expect(mocks.transaction.emailOtp.updateMany).toHaveBeenCalled();
    expect(mocks.transaction.user.update).toHaveBeenCalled();
  });
});
