import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/sessions/sessionLibrary.repository.js", () => ({
  findAdmin: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  updateSafely: vi.fn(),
  archiveSafely: vi.fn(),
  restoreSafely: vi.fn(),
  removePermanently: vi.fn(),
}));

vi.mock("../audit/audit.service.js", () => ({
  recordActionService: vi.fn(),
}));

import * as sessionRepo from "../../../repositories/v1/sessions/sessionLibrary.repository.js";
import { recordActionService } from "../audit/audit.service.js";
import {
  archiveSessionLibraryItemService,
  createSessionLibraryItemService,
  deleteSessionLibraryItemPermanentlyService,
  listSessionLibraryService,
  updateSessionLibraryItemService,
} from "./sessionLibrary.service.js";

function sessionFixture(overrides = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Introduction to machine learning",
    description: null,
    recordingUrl: null,
    materialUrl: null,
    quizUrl: null,
    feedbackUrl: null,
    durationMinutes: 60,
    status: "READY",
    createdAt: new Date("2026-08-07T00:00:00.000Z"),
    updatedAt: new Date("2026-08-07T00:00:00.000Z"),
    courseSessions: [],
    ...overrides,
  };
}

describe("Session Library service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated sessions with course and group impact counts", async () => {
    sessionRepo.findAdmin.mockResolvedValue({
      total: 1,
      sessions: [
        sessionFixture({
          courseSessions: [
            {
              id: "course-session-1",
              courseId: "course-1",
              orderIndex: 0,
              retiredAt: null,
              course: { title: "ML 1", courseGroupId: "group-1" },
            },
          ],
        }),
      ],
    });

    const result = await listSessionLibraryService({ limit: "20", offset: "0" });

    expect(result.sessions[0].usage).toMatchObject({
      courseCount: 1,
      activeCourseCount: 1,
      courseGroupCount: 1,
    });
    expect(result.pagination).toEqual({
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
  });

  it("passes the course attachability filter to the repository", async () => {
    const attachableCourseId = "20000000-0000-4000-8000-000000000002";
    sessionRepo.findAdmin.mockResolvedValue({ total: 0, sessions: [] });

    await listSessionLibraryService({
      status: "READY",
      attachableCourseId,
      limit: "100",
    });

    expect(sessionRepo.findAdmin).toHaveBeenCalledWith(
      { status: "READY", attachableCourseId },
      100,
      0,
    );
  });

  it("creates an independent draft session and records an audit event", async () => {
    sessionRepo.create.mockImplementation(async (data) =>
      sessionFixture({ ...data, courseSessions: [] }),
    );

    const result = await createSessionLibraryItemService(
      {
        title: "Introduction to machine learning",
      },
      "actor-1",
    );

    expect(sessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DRAFT" }),
    );
    expect(result.usage.courseCount).toBe(0);
    expect(recordActionService).toHaveBeenCalledOnce();
  });

  it("blocks editing an archived session", async () => {
    sessionRepo.updateSafely.mockRejectedValue(
      new Error("Archived sessions must be restored before editing."),
    );

    await expect(
      updateSessionLibraryItemService(
        sessionFixture().id,
        { title: "Updated machine learning lesson" },
        "actor-1",
      ),
    ).rejects.toThrow(/restored before editing/i);
    expect(sessionRepo.updateSafely).toHaveBeenCalledOnce();
  });

  it("requires a recording before a session becomes ready", async () => {
    await expect(
      createSessionLibraryItemService(
        {
          title: "Recording is still processing",
          status: "READY",
        },
        "actor-1",
      ),
    ).rejects.toThrow(/recording URL/i);
  });

  it("archives without removing usage relationships", async () => {
    const current = sessionFixture({
      courseSessions: [{ course: { courseGroupId: "group-1" } }],
    });
    sessionRepo.archiveSafely.mockResolvedValue({
      previous: current,
      session: sessionFixture({
        status: "ARCHIVED",
        courseSessions: current.courseSessions,
      }),
      changed: true,
    });

    const result = await archiveSessionLibraryItemService(
      current.id,
      "actor-1",
    );

    expect(result.status).toBe("ARCHIVED");
    expect(result.usage).toMatchObject({ courseCount: 1, courseGroupCount: 1 });
    expect(sessionRepo.archiveSafely).toHaveBeenCalledWith(current.id);
  });

  it("requires an archived, unused session for permanent deletion", async () => {
    sessionRepo.findById.mockResolvedValue(
      sessionFixture({
        status: "ARCHIVED",
        courseSessions: [{ course: { courseGroupId: "group-1" } }],
      }),
    );

    await expect(
      deleteSessionLibraryItemPermanentlyService(
        sessionFixture().id,
        "actor-1",
      ),
    ).rejects.toThrow(/curriculum or delivery history/i);
    expect(sessionRepo.removePermanently).not.toHaveBeenCalled();
  });
});
