import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("../../../utils/prisma.js", () => ({
  default: {
    session: {
      count: mocks.count,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      create: mocks.create,
    },
    $queryRaw: mocks.queryRaw,
  },
}));

import { duplicate, findAdmin } from "./sessionLibrary.repository.js";

describe("Session Library repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
  });

  it("resolves a partial tag match to matching ids, then filters by id", async () => {
    mocks.queryRaw.mockResolvedValue([{ id: "session-1" }, { id: "session-2" }]);

    await findAdmin({ tag: "jav" }, 50, 0);

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    const expectedWhere = { id: { in: ["session-1", "session-2"] } };
    expect(mocks.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });

  it("returns no results when a tag filter matches nothing", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await findAdmin({ tag: "nonexistent" }, 50, 0);

    expect(mocks.count).toHaveBeenCalledWith({ where: { id: { in: [] } } });
  });

  it("sorts the newest sessions first by creation time", async () => {
    await findAdmin({}, 50, 0);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { title: "asc" }],
      }),
    );
  });

  it("duplicates a session's content as a new draft, never its usage", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "source-id",
      title: "Original lesson",
      description: "Learn the basics",
      recordingUrl: "https://example.com/rec",
      materialUrl: null,
      quizUrl: null,
      feedbackUrl: null,
      durationMinutes: 30,
      tags: ["intro"],
      status: "READY",
    });
    mocks.create.mockImplementation(async ({ data }) => ({ id: "new-id", ...data }));

    const result = await duplicate("source-id");

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Original lesson (Copy)",
          tags: ["intro"],
          status: "DRAFT",
        }),
      }),
    );
    expect(result.status).toBe("DRAFT");
  });

  it("rejects duplicating a session that does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(duplicate("missing-id")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.create).not.toHaveBeenCalled();
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
      AND: [{ courseSessions: { none: { courseId } } }],
    };
    expect(mocks.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, take: 100, skip: 0 }),
    );
  });
});
