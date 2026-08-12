import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/catalog/category.repository.js", () => ({
  findById: vi.fn(),
}));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  updateEnrollmentStatus: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("./publicCatalogCache.service.js", () => ({
  revalidatePublicCatalogCache: vi.fn(),
}));

import * as categoryRepo from "../../../repositories/v1/catalog/category.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  createCourseService,
  setCourseEnrollmentStatusService,
  updateCourseService,
} from "./course.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const categoryId = "90000000-0000-4000-8000-000000000002";
const courseId = "90000000-0000-4000-8000-000000000003";

function courseFixture(overrides = {}) {
  return {
    id: courseId,
    categoryId,
    slug: "free-foundations",
    title: "Free Foundations",
    summary: "A practical free learning course.",
    description: "A practical free learning course for beginning students.",
    level: "BEGINNER",
    durationValue: null,
    durationUnit: null,
    accessType: "FREE",
    price: 0,
    currency: "LKR",
    enrollmentStatus: "COMING_SOON",
    certificateEnabled: false,
    highlights: [],
    skills: [],
    prerequisites: [],
    thumbnailUrl: null,
    status: "PUBLISHED",
    sortOrder: 0,
    category: {
      id: categoryId,
      serviceType: "FREE_LEARNING",
      status: "PUBLISHED",
    },
    _count: { courseSessions: 0, batches: 0, enrollments: 0 },
    ...overrides,
  };
}

describe("course enrollment availability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores LKR centrally when a course is created", async () => {
    categoryRepo.findById.mockResolvedValue(courseFixture().category);
    courseRepo.create.mockImplementation(async (data) => courseFixture({
      ...data,
      status: "DRAFT",
    }));

    await createCourseService({
      categoryId,
      slug: "free-foundations",
      title: "Free Foundations",
      summary: "A practical free learning course.",
      description: "A practical free learning course for beginning students.",
      level: "BEGINNER",
      accessType: "FREE",
      price: 0,
      certificateEnabled: false,
    }, actorId);

    expect(courseRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "LKR", status: "DRAFT" }),
    );
  });

  it("requires an explicit certificate policy when the course is created", async () => {
    await expect(
      createCourseService({
        categoryId,
        slug: "free-foundations",
        title: "Free Foundations",
        summary: "A practical free learning course.",
        description: "A practical free learning course for beginning students.",
        level: "BEGINNER",
        accessType: "FREE",
        price: 0,
      }, actorId),
    ).rejects.toMatchObject({ field: "certificateEnabled", statusCode: 400 });
    expect(categoryRepo.findById).not.toHaveBeenCalled();
    expect(courseRepo.create).not.toHaveBeenCalled();
  });

  it("does not allow certificate policy to change after course creation", async () => {
    await expect(
      updateCourseService(
        courseId,
        { title: "Updated title", certificateEnabled: true },
        actorId,
      ),
    ).rejects.toThrow(/selected when the course is created/i);
    expect(courseRepo.findById).not.toHaveBeenCalled();
    expect(courseRepo.update).not.toHaveBeenCalled();
  });

  it("does not open an empty Free Learning course", async () => {
    courseRepo.findById.mockResolvedValue(courseFixture());

    await expect(
      setCourseEnrollmentStatusService(courseId, { status: "OPEN" }, actorId),
    ).rejects.toThrow(/attach at least one session/i);
    expect(courseRepo.updateEnrollmentStatus).not.toHaveBeenCalled();
  });

  it("opens a Free Learning course once curriculum exists", async () => {
    const current = courseFixture({ _count: { courseSessions: 1, batches: 0, enrollments: 0 } });
    courseRepo.findById.mockResolvedValue(current);
    courseRepo.updateEnrollmentStatus.mockResolvedValue({
      ...current,
      enrollmentStatus: "OPEN",
    });

    const result = await setCourseEnrollmentStatusService(
      courseId,
      { status: "OPEN" },
      actorId,
    );

    expect(result.enrollmentStatus).toBe("OPEN");
  });

  it("does not expose this lifecycle for paid cohort courses", async () => {
    courseRepo.findById.mockResolvedValue(courseFixture({
      accessType: "PAID",
      category: { serviceType: "BOOTCAMPS", status: "PUBLISHED" },
    }));

    await expect(
      setCourseEnrollmentStatusService(courseId, { status: "OPEN" }, actorId),
    ).rejects.toThrow(/only for Free Learning/i);
  });
});
