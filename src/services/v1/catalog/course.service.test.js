import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/catalog/category.repository.js", () => ({ findById: vi.fn() }));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  create: vi.fn(), findById: vi.fn(), update: vi.fn(), setArchived: vi.fn(), remove: vi.fn(), findDeletionImpact: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as categoryRepository from "../../../repositories/v1/catalog/category.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import { createCourseService, updateCourseService } from "./course.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const categoryId = "90000000-0000-4000-8000-000000000003";
const courseId = "90000000-0000-4000-8000-000000000004";

function categoryFixture(overrides = {}) {
  return {
    id: categoryId,
    status: "PUBLISHED",
    service: { id: "service-paid", key: "BOOTCAMPS", status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL" },
    ...overrides,
  };
}

function courseFixture(overrides = {}) {
  return {
    id: courseId, categoryId, slug: "ai-ml-ignition", title: "AI/ML Ignition Program",
    summary: "A practical AI and machine learning program.",
    description: "A practical AI and machine learning program for beginning engineers.",
    level: "BEGINNER", durationValue: 4, durationUnit: "MONTH", price: 1000, currency: "LKR",
    intakeCodePrefix: "AI-ML-IGNITION", certificateEnabled: true, discountAmount: 1000,
    enrollmentStatus: "COMING_SOON", archivedAt: null, category: categoryFixture(),
    _count: { intakes: 0 }, ...overrides,
  };
}

const createInput = {
  categoryId, slug: "ai-ml-ignition", title: "AI/ML Ignition Program",
  summary: "A practical AI and machine learning program.",
  description: "A practical AI and machine learning program for beginning engineers.",
  level: "BEGINNER", durationValue: 4, durationUnit: "MONTH", price: 1000,
  intakeCodePrefix: "AI-ML-IGNITION", certificateEnabled: true,
};

describe("course service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a course with the currency defaulted server-side", async () => {
    categoryRepository.findById.mockResolvedValue(categoryFixture());
    courseRepository.create.mockResolvedValue(courseFixture());
    const result = await createCourseService(createInput, actorId);
    expect(courseRepository.create).toHaveBeenCalledWith(expect.objectContaining({ categoryId, title: "AI/ML Ignition Program", currency: "LKR" }));
    expect(result.title).toBe("AI/ML Ignition Program");
  });

  it("rejects a paid course with a zero price", async () => {
    categoryRepository.findById.mockResolvedValue(categoryFixture());
    await expect(createCourseService({ ...createInput, price: 0 }, actorId)).rejects.toMatchObject({ statusCode: 400 });
    expect(courseRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a free-service course with a nonzero price", async () => {
    categoryRepository.findById.mockResolvedValue(categoryFixture({ service: { ...categoryFixture().service, accessType: "FREE" } }));
    await expect(createCourseService({ ...createInput, price: 500 }, actorId)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("does not accept certificateEnabled, discountAmount, or intakeCodePrefix on update", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture());
    await expect(updateCourseService(courseId, { certificateEnabled: false }, actorId)).rejects.toMatchObject({ statusCode: 400 });
    expect(courseRepository.update).not.toHaveBeenCalled();
  });
});
