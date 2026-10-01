import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../utils/Errors.js";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    loginChallenge: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      loginChallenge: { count: vi.fn(), aggregate: vi.fn() },
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { getRecentLoginChallengeActivity, verifyLoginChallenge } from "./auth.repository.js";

const MAX_ATTEMPTS = 5;
const admin = { id: "admin-1", role: "SUPER_ADMIN", emailVerified: true };

function challenge(overrides = {}) {
  return {
    id: "challenge-1",
    codeHash: "right-hash",
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: admin,
    ...overrides,
  };
}

// The emailed second factor is the only thing between a leaked admin
// password and full admin access, so each guard is pinned here.
describe("administrator login challenge verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.loginChallenge.updateMany.mockResolvedValue({ count: 1 });
  });

  it("serializes verification on the challenge with an advisory lock", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(challenge());
    await verifyLoginChallenge("challenge-1", ["right-hash"], MAX_ATTEMPTS);
    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), "login-mfa:challenge-1");
  });

  it("counts a wrong code against the challenge", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(challenge({ attempts: 2 }));

    await expect(verifyLoginChallenge("challenge-1", ["wrong-hash"], MAX_ATTEMPTS)).rejects.toThrow("Incorrect code");
    expect(mocks.transaction.loginChallenge.update).toHaveBeenCalledWith({
      where: { id: "challenge-1" },
      data: { attempts: { increment: 1 } },
    });
    expect(mocks.transaction.loginChallenge.updateMany).not.toHaveBeenCalled();
  });

  it("locks the challenge once the attempts are used up, even for the right code", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(challenge({ attempts: MAX_ATTEMPTS }));

    const error = await verifyLoginChallenge("challenge-1", ["right-hash"], MAX_ATTEMPTS).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toMatch(/Too many incorrect attempts/);
    expect(mocks.transaction.loginChallenge.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a challenge that was already used", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(challenge({ usedAt: new Date() }));
    await expect(verifyLoginChallenge("challenge-1", ["right-hash"], MAX_ATTEMPTS)).rejects.toThrow(/invalid or expired/);
  });

  it("rejects an expired challenge", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(challenge({ expiresAt: new Date(Date.now() - 1) }));
    await expect(verifyLoginChallenge("challenge-1", ["right-hash"], MAX_ATTEMPTS)).rejects.toThrow(/invalid or expired/);
  });

  it("rejects an unknown challenge", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(null);
    await expect(verifyLoginChallenge("challenge-1", ["right-hash"], MAX_ATTEMPTS)).rejects.toThrow(/invalid or expired/);
  });

  it("consumes the challenge exactly once on the right code", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(challenge());

    const user = await verifyLoginChallenge("challenge-1", ["right-hash"], MAX_ATTEMPTS);
    expect(user).toBe(admin);
    expect(mocks.transaction.loginChallenge.updateMany).toHaveBeenCalledWith({
      where: { id: "challenge-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("loses the race when a parallel request consumed it first", async () => {
    mocks.transaction.loginChallenge.findUnique.mockResolvedValue(challenge());
    mocks.transaction.loginChallenge.updateMany.mockResolvedValue({ count: 0 });
    await expect(verifyLoginChallenge("challenge-1", ["right-hash"], MAX_ATTEMPTS)).rejects.toThrow(/invalid or expired/);
  });
});

describe("recent administrator login activity", () => {
  it("sums wrong codes across every recent challenge of the account", async () => {
    mocks.prisma.loginChallenge.count.mockResolvedValue(4);
    mocks.prisma.loginChallenge.aggregate.mockResolvedValue({ _sum: { attempts: 11 } });
    const since = new Date();

    await expect(getRecentLoginChallengeActivity("admin-1", since)).resolves.toEqual({ issued: 4, failedAttempts: 11 });
    expect(mocks.prisma.loginChallenge.aggregate).toHaveBeenCalledWith({
      where: { userId: "admin-1", createdAt: { gte: since } },
      _sum: { attempts: true },
    });
  });
});
