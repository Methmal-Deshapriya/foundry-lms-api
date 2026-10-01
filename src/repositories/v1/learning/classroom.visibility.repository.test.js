import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prisma: { courseSession: { findMany: vi.fn() } } }));
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { findVisibleSessions, sortCurriculum } from "./classroom.repository.js";

describe("what a learner can see (M07-13)", () => {
  it("only asks for released sessions, or scheduled ones whose time has passed, of ready or archived library sessions", async () => {
    mocks.prisma.courseSession.findMany.mockResolvedValue([]);
    const now = new Date("2026-10-01T03:30:00.000Z");
    await findVisibleSessions("intake-1", "enrollment-1", now);
    const { where } = mocks.prisma.courseSession.findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      intakeId: "intake-1",
      deliveryStatus: { in: ["RELEASED", "SCHEDULED"] },
      OR: [{ deliveryStatus: "RELEASED" }, { deliveryStatus: "SCHEDULED", availableAt: { lte: now } }],
      session: { status: { in: ["READY", "ARCHIVED"] } },
    });
  });
});

describe("curriculum order (M07-02)", () => {
  it("lists the live curriculum first, then retired sessions in their former position", () => {
    const rows = [
      { id: "retired-b", orderIndex: null, historicalOrderIndex: 4, retiredAt: new Date("2026-09-01") },
      { id: "live-2", orderIndex: 2, retiredAt: null },
      { id: "retired-a", orderIndex: null, historicalOrderIndex: 1, retiredAt: new Date("2026-09-20") },
      { id: "live-0", orderIndex: 0, retiredAt: null },
      { id: "live-1", orderIndex: 1, retiredAt: null },
    ];
    expect(sortCurriculum(rows).map((row) => row.id)).toEqual(["live-0", "live-1", "live-2", "retired-a", "retired-b"]);
  });
});
