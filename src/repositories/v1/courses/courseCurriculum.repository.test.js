import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCourseSessions: vi.fn(),
  findBatchSessions: vi.fn(),
}));

vi.mock("../../../utils/prisma.js", () => ({
  default: {
    courseSession: { findMany: mocks.findCourseSessions },
    batchSession: { findMany: mocks.findBatchSessions },
  },
}));

import { findByCourseId } from "./courseCurriculum.repository.js";

describe("Course curriculum repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads batch details only for retired curriculum relationships", async () => {
    mocks.findCourseSessions.mockResolvedValue([
      { id: "active-link", retiredAt: null },
      { id: "retired-link", retiredAt: new Date("2026-08-09") },
    ]);
    mocks.findBatchSessions.mockResolvedValue([
      {
        id: "batch-link",
        courseSessionId: "retired-link",
        batchId: "batch-1",
        batch: { name: "August 2026", code: "ML1-2026-AUG", status: "ACTIVE" },
      },
    ]);

    const result = await findByCourseId("course-1", true);

    expect(mocks.findBatchSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseId: "course-1",
          courseSession: { retiredAt: { not: null } },
        },
      }),
    );
    expect(result[0].batchLinks).toEqual([]);
    expect(result[1].batchLinks).toHaveLength(1);
  });

  it("does not query batch details for the active-only curriculum", async () => {
    mocks.findCourseSessions.mockResolvedValue([
      { id: "active-link", retiredAt: null },
    ]);

    const result = await findByCourseId("course-1");

    expect(mocks.findBatchSessions).not.toHaveBeenCalled();
    expect(result[0].batchLinks).toEqual([]);
  });
});
