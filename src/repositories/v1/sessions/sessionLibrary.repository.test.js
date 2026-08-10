import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../../../utils/prisma.js", () => ({
  default: {
    session: {
      count: mocks.count,
      findMany: mocks.findMany,
    },
  },
}));

import { findAdmin } from "./sessionLibrary.repository.js";

describe("Session Library repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);
  });

  it("mirrors curriculum attachability rules for a target course", async () => {
    const courseId = "20000000-0000-4000-8000-000000000002";

    await findAdmin(
      { status: "READY", attachableCourseId: courseId },
      100,
      0,
    );

    const expectedWhere = {
      status: "READY",
      AND: [
        {
          courseSessions: {
            none: { courseId },
          },
        },
        {
          OR: [
            { reusePolicy: "REUSABLE" },
            {
              reusePolicy: "SINGLE_COURSE",
              courseSessions: {
                none: { courseId: { not: courseId } },
              },
            },
          ],
        },
      ],
    };
    expect(mocks.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, take: 100, skip: 0 }),
    );
  });
});
