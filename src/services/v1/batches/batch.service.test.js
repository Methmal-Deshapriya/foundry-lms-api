import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/batches/batch.repository.js", () => ({
  findAdminByCourse: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  transitionStatus: vi.fn(),
  findSessions: vi.fn(),
  findSession: vi.fn(),
  updateDelivery: vi.fn(),
  findCompletionReadiness: vi.fn(),
}));

vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  findById: vi.fn(),
}));

vi.mock("../audit/audit.service.js", () => ({
  recordActionService: vi.fn(),
}));

import * as batchRepo from "../../../repositories/v1/batches/batch.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  createBatchService,
  getBatchSessionsService,
  updateBatchSessionDeliveryService,
  updateBatchStatusService,
} from "./batch.service.js";

function courseFixture(serviceType = "BOOTCAMPS", status = "PUBLISHED") {
  return {
    id: "60000000-0000-4000-8000-000000000001",
    title: "Machine Learning 1",
    status,
    category: { serviceType, status },
    _count: { courseSessions: 2 },
  };
}

function batchFixture(overrides = {}) {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    courseId: courseFixture().id,
    name: "August 2026",
    code: "ML1-2026-AUG",
    startDate: new Date("2026-08-01"),
    expectedEndDate: new Date("2026-12-01"),
    timezone: "Asia/Colombo",
    capacity: 30,
    status: "ACTIVE",
    course: courseFixture(),
    _count: { enrollments: 10 },
    ...overrides,
  };
}

describe("batch service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects batches for Free Learning courses", async () => {
    courseRepo.findById.mockResolvedValue(courseFixture("FREE_LEARNING"));

    await expect(
      createBatchService(
        courseFixture().id,
        {
          name: "Invalid free batch",
          code: "FREE-2026-AUG",
          startDate: "2026-08-01",
          expectedEndDate: "2026-12-01",
        },
        "actor-1",
      ),
    ).rejects.toThrow(/only for cohort/i);
    expect(batchRepo.create).not.toHaveBeenCalled();
  });

  it("enforces explicit batch status transitions", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture({ status: "COMPLETED" }));

    await expect(
      updateBatchStatusService(
        batchFixture().id,
        { status: "ACTIVE" },
        "actor-1",
      ),
    ).rejects.toThrow(/cannot move/i);
  });

  it("blocks release before a batch is active", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture({ status: "ENROLLING" }));
    batchRepo.findSession.mockResolvedValue({
      courseSessionId: "80000000-0000-4000-8000-000000000001",
      inherited: true,
      isReleased: false,
    });

    await expect(
      updateBatchSessionDeliveryService(
        batchFixture().id,
        "80000000-0000-4000-8000-000000000001",
        { mode: "RELEASED" },
        "actor-1",
      ),
    ).rejects.toThrow(/only while the batch is active/i);
    expect(batchRepo.updateDelivery).not.toHaveBeenCalled();
  });

  it("allows an archived course's active batch to update an existing assignment", async () => {
    const archivedCourse = courseFixture("BOOTCAMPS", "ARCHIVED");
    batchRepo.findById.mockResolvedValue(
      batchFixture({ course: archivedCourse, status: "ACTIVE" }),
    );
    batchRepo.findSession.mockResolvedValue({
      id: "batch-session-1",
      isReleased: false,
    });
    batchRepo.updateDelivery.mockResolvedValue({
      id: "batch-session-1",
      inherited: false,
      isReleased: true,
      availableAt: null,
      courseSession: { session: { title: "Session 1" } },
    });

    await expect(
      updateBatchSessionDeliveryService(
        batchFixture().id,
        "80000000-0000-4000-8000-000000000001",
        { mode: "RELEASED" },
        "actor-1",
      ),
    ).resolves.toMatchObject({ state: "RELEASED" });
  });

  it("derives unreleased, withdrawn, scheduled, and released states", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture());
    batchRepo.findCompletionReadiness.mockResolvedValue({});
    batchRepo.findSessions.mockResolvedValue([
      { id: null, inherited: true, isReleased: false, availableAt: null },
      { id: "withdrawn", inherited: false, isReleased: false, availableAt: null },
      {
        id: "scheduled",
        inherited: false,
        isReleased: true,
        availableAt: new Date(Date.now() + 60_000),
      },
      {
        id: "available",
        inherited: false,
        isReleased: true,
        availableAt: new Date(Date.now() - 60_000),
      },
    ]);

    const result = await getBatchSessionsService(batchFixture().id);
    expect(result.sessions.map(({ state }) => state)).toEqual([
      "UNRELEASED",
      "WITHDRAWN",
      "SCHEDULED",
      "RELEASED",
    ]);
  });

  it("blocks manual completion until curriculum and certificate readiness pass", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture());
    batchRepo.transitionStatus.mockRejectedValue(
      new Error("This batch is not ready to complete."),
    );

    await expect(
      updateBatchStatusService(
        batchFixture().id,
        { status: "COMPLETED" },
        "actor-1",
      ),
    ).rejects.toThrow(/not ready to complete/i);
    expect(batchRepo.transitionStatus).toHaveBeenCalledWith(
      batchFixture().id,
      "ACTIVE",
      "COMPLETED",
      { requireCompletionReadiness: true },
    );
  });
});
