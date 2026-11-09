import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    courseSession: { groupBy: vi.fn() },
    sessionCompletion: { groupBy: vi.fn() },
    enrollment: { groupBy: vi.fn() },
  },
}));
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { getIntakeDeliveryStats, resolveTrendWindow, seedMonthBuckets } from "./dashboard.repository.js";

afterEach(() => vi.useRealTimers());

describe("dashboard trends run on Sri Lanka time (M10-03 / M10-13)", () => {
  it("reads a custom range as whole Sri Lanka days", () => {
    const { start, end } = resolveTrendWindow({ from: new Date("2026-10-01"), to: new Date("2026-10-31") });
    expect(start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-31T18:29:59.999Z");
  });

  it("starts a preset window at the start of a Sri Lanka month", () => {
    // 1 Nov, 02:00 in Colombo is still 31 Oct in UTC.
    vi.useFakeTimers({ now: new Date("2026-10-31T20:30:00.000Z") });
    const { start } = resolveTrendWindow({ months: 3 });
    expect(start.toISOString()).toBe("2026-08-31T18:30:00.000Z");
  });

  it("seeds one bucket per Sri Lanka month, the current one last", () => {
    const buckets = seedMonthBuckets(new Date("2026-08-31T18:30:00.000Z"), new Date("2026-10-31T20:30:00.000Z"));
    expect(buckets.map((bucket) => bucket.key)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(buckets[2].label).toBe("Nov 26");
  });
});

describe("course delivery completion % (M10-14)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts only active learners' completions of released sessions, and never passes 100%", async () => {
    mocks.prisma.courseSession.groupBy.mockResolvedValueOnce([{ intakeId: "i-1", _count: 2 }]).mockResolvedValueOnce([{ intakeId: "i-1", _count: 4 }]);
    mocks.prisma.sessionCompletion.groupBy.mockResolvedValue([{ intakeId: "i-1", _count: 9 }]);
    mocks.prisma.enrollment.groupBy.mockResolvedValue([{ intakeId: "i-1", _count: 4 }]);

    const stats = await getIntakeDeliveryStats(["i-1"]);

    const where = mocks.prisma.sessionCompletion.groupBy.mock.calls[0][0].where;
    expect(where.enrollment).toEqual({ status: "ACTIVE" });
    expect(where.courseSession).toMatchObject({ intakeId: { in: ["i-1"] }, deliveryStatus: { in: ["RELEASED", "SCHEDULED"] } });
    // 9 completions over 2 released × 4 active = 8 possible: capped at 100.
    expect(stats.get("i-1")).toMatchObject({ releasedSessions: 2, totalSessions: 4, completionPct: 100 });
  });
});
