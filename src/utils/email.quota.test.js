import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    emailDailyUsage: { findUnique: vi.fn(), aggregate: vi.fn(), upsert: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (operation) => operation(transaction)),
      emailDailyUsage: { updateMany: vi.fn() },
    },
  };
});
vi.mock("./prisma.js", () => ({ default: mocks.prisma }));

import { releaseEmailQuota, reserveEmailQuota } from "./email.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.emailDailyUsage.findUnique.mockResolvedValue({ count: 30 });
  mocks.transaction.emailDailyUsage.aggregate.mockResolvedValue({ _sum: { count: 500 } });
});

describe("bulk email quota reservation (M09-01)", () => {
  it("checks and reserves under one lock", async () => {
    const roomFor = vi.fn(() => 50);
    const result = await reserveEmailQuota(12, roomFor);

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), "email-quota");
    expect(roomFor).toHaveBeenCalledWith(expect.objectContaining({ sentToday: 30, sentThisMonth: 500 }));
    expect(mocks.transaction.emailDailyUsage.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { count: { increment: 12 } } }));
    expect(result).toMatchObject({ ok: true, room: 50 });
  });

  it("reserves nothing when the send doesn't fit", async () => {
    await expect(reserveEmailQuota(51, () => 50)).resolves.toMatchObject({ ok: false, room: 50 });
    expect(mocks.transaction.emailDailyUsage.upsert).not.toHaveBeenCalled();
  });

  it("gives back unsent emails on the reserved day", async () => {
    const day = new Date("2026-10-02");
    await releaseEmailQuota(day, 3);
    expect(mocks.prisma.emailDailyUsage.updateMany).toHaveBeenCalledWith({ where: { day }, data: { count: { decrement: 3 } } });
    await releaseEmailQuota(day, 0);
    expect(mocks.prisma.emailDailyUsage.updateMany).toHaveBeenCalledTimes(1);
  });
});
