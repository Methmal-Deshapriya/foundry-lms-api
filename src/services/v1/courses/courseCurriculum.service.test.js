import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/courses/courseCurriculum.repository.js", () => ({
  findByCourseId: vi.fn(),
  findById: vi.fn(),
  attachExisting: vi.fn(),
  createAndAttach: vi.fn(),
  reorder: vi.fn(),
  removeOrRetire: vi.fn(),
}));

vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  findById: vi.fn(),
}));

vi.mock("../audit/audit.service.js", () => ({
  recordActionService: vi.fn(),
}));

import * as curriculumRepo from "../../../repositories/v1/courses/courseCurriculum.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  attachCourseSessionService,
  getCourseCurriculumService,
  removeCourseSessionService,
  reorderCourseCurriculumService,
} from "./courseCurriculum.service.js";

function courseFixture(serviceType = "BOOTCAMPS") {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    title: "Machine Learning 1",
    status: "PUBLISHED",
    category: {
      id: "30000000-0000-4000-8000-000000000001",
      title: "Machine Learning",
      serviceType,
      status: "PUBLISHED",
    },
    _count: { courseSessions: 1, batches: 0, enrollments: 4 },
  };
}

function curriculumFixture() {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    courseId: courseFixture().id,
    orderIndex: 0,
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    session: {
      id: "50000000-0000-4000-8000-000000000001",
      title: "Session 1",
      status: "READY",
      reusePolicy: "REUSABLE",
    },
    _count: { batchLinks: 2, completions: 3 },
  };
}

describe("course curriculum service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports immediate availability and affected learners for Free Learning", async () => {
    courseRepo.findById.mockResolvedValue(courseFixture("FREE_LEARNING"));
    curriculumRepo.findByCourseId.mockResolvedValue([curriculumFixture()]);

    const result = await getCourseCurriculumService(courseFixture().id);

    expect(result.delivery).toMatchObject({
      deliveryMode: "SELF_PACED",
      immediateAvailability: true,
      affectedLearnerCount: 4,
    });
    expect(result.curriculum[0].usage).toEqual({
      batchCount: 2,
      completionCount: 3,
      batches: [],
    });
  });

  it("includes batch assignments for retired curriculum relationships", async () => {
    courseRepo.findById.mockResolvedValue(courseFixture());
    curriculumRepo.findByCourseId.mockResolvedValue([
      {
        ...curriculumFixture(),
        orderIndex: null,
        retiredAt: new Date("2026-08-09T09:14:28.079Z"),
        batchLinks: [
          {
            id: "60000000-0000-4000-8000-000000000001",
            batchId: "70000000-0000-4000-8000-000000000001",
            isReleased: false,
            availableAt: null,
            batch: {
              name: "August 2026",
              code: "ML1-2026-AUG",
              status: "ACTIVE",
            },
          },
        ],
      },
    ]);

    const result = await getCourseCurriculumService(courseFixture().id, {
      includeRetired: "true",
    });

    expect(curriculumRepo.findByCourseId).toHaveBeenCalledWith(
      courseFixture().id,
      true,
    );
    expect(result.curriculum[0].usage.batches).toEqual([
      expect.objectContaining({
        batchName: "August 2026",
        batchStatus: "ACTIVE",
        isReleased: false,
      }),
    ]);
  });

  it("requires a recording for create-and-attach", async () => {
    courseRepo.findById.mockResolvedValue(courseFixture());

    await expect(
      attachCourseSessionService(
        courseFixture().id,
        {
          session: {
            title: "Session without recording",
            reusePolicy: "SINGLE_COURSE",
          },
        },
        "actor-1",
      ),
    ).rejects.toThrow(/recording URL/i);
    expect(curriculumRepo.createAndAttach).not.toHaveBeenCalled();
  });

  it("rejects duplicate or discontinuous reorder payloads", async () => {
    const id = curriculumFixture().id;
    await expect(
      reorderCourseCurriculumService(
        courseFixture().id,
        {
          courseSessions: [
            { id, orderIndex: 0 },
            { id, orderIndex: 2 },
          ],
        },
        "actor-1",
      ),
    ).rejects.toThrow(/unique and use continuous/i);
    expect(courseRepo.findById).not.toHaveBeenCalled();
  });

  it("does not remove a curriculum item through another course", async () => {
    courseRepo.findById.mockResolvedValue(courseFixture());
    curriculumRepo.findById.mockResolvedValue({
      ...curriculumFixture(),
      courseId: "different-course",
    });

    await expect(
      removeCourseSessionService(
        courseFixture().id,
        curriculumFixture().id,
        "actor-1",
      ),
    ).rejects.toThrow(/not found/i);
    expect(curriculumRepo.removeOrRetire).not.toHaveBeenCalled();
  });
});
