import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/catalog/courseGroup.repository.js", () => ({ findById: vi.fn() }));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  create: vi.fn(), findById: vi.fn(), transitionStatus: vi.fn(), updateSetup: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("./publicCatalogCache.service.js", () => ({ revalidatePublicCatalogCache: vi.fn() }));

import * as groupRepository from "../../../repositories/v1/catalog/courseGroup.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import { createCourseService, updateCourseService, updateCourseStatusService } from "./course.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const groupId = "90000000-0000-4000-8000-000000000002";
const categoryId = "90000000-0000-4000-8000-000000000003";
const courseId = "90000000-0000-4000-8000-000000000004";

function groupFixture(overrides = {}) {
  return { id: groupId, categoryId, slug: "ai-ml-ignition", title: "AI/ML Ignition Program", batchCodePrefix: "AI-ML-IGNITION", certificateEnabled: true, archivedAt: null, courses: [], category: { id: categoryId, status: "PUBLISHED", service: { id: "service-paid", key: "BOOTCAMPS", status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } }, ...overrides };
}

function courseFixture(overrides = {}) {
  return {
    id: courseId, courseGroupId: groupId, categoryId, slug: "ai-ml-ignition", title: "AI/ML Ignition Program",
    intakeKey: "2026-B1", code: "AI-ML-IGNITION-2026-B1",
    startDate: new Date("2026-09-01T00:00:00Z"), expectedEndDate: new Date("2026-12-01T00:00:00Z"),
    timezone: "Asia/Colombo", capacity: 50, summary: "A practical AI and machine learning program.",
    description: "A practical AI and machine learning program for beginning engineers.", level: "BEGINNER",
    durationValue: 4, durationUnit: "MONTH", price: 1000, currency: "LKR",
    highlights: [], skills: [], prerequisites: [], thumbnailUrl: null, sortOrder: 0,
    status: "DRAFT", category: groupFixture().category, courseGroup: groupFixture(),
    _count: { courseSessions: 0, enrollments: 0 }, ...overrides,
  };
}

const firstInput = {
  courseGroupId: groupId, intakeKey: "2026-B1",
  startDate: "2026-09-01T00:00:00Z", expectedEndDate: "2026-12-01T00:00:00Z", capacity: 50,
  summary: "A practical AI and machine learning program.",
  description: "A practical AI and machine learning program for beginning engineers.",
  level: "BEGINNER", durationValue: 4, durationUnit: "MONTH", price: 1000,
};

describe("course intake service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the first intake with group-owned identity and LKR", async () => {
    groupRepository.findById.mockResolvedValue(groupFixture());
    courseRepository.create.mockResolvedValue(courseFixture());
    courseRepository.findById.mockResolvedValue(courseFixture());
    const result = await createCourseService(firstInput, actorId);
    expect(courseRepository.create).toHaveBeenCalledWith(expect.objectContaining({ categoryId, courseGroupId: groupId, slug: "ai-ml-ignition", title: "AI/ML Ignition Program", code: "AI-ML-IGNITION-2026-B1", currency: "LKR", status: "DRAFT" }), null);
    expect(result.code).toBe("AI-ML-IGNITION-2026-B1");
  });

  it("copies immutable public content into later intakes", async () => {
    const source = courseFixture();
    groupRepository.findById.mockResolvedValue(groupFixture({ courses: [source] }));
    courseRepository.findById.mockResolvedValueOnce(source).mockResolvedValueOnce(courseFixture({ id: "new-course", intakeKey: "2026-B2", code: "AI-ML-IGNITION-2026-B2" }));
    courseRepository.create.mockResolvedValue({ id: "new-course" });
    await createCourseService({ courseGroupId: groupId, sourceCourseId: courseId, intakeKey: "2026-B2", startDate: "2027-01-01T00:00:00Z", expectedEndDate: "2027-04-01T00:00:00Z", summary: "This override is ignored." }, actorId);
    expect(courseRepository.create).toHaveBeenCalledWith(expect.objectContaining({ summary: source.summary, code: "AI-ML-IGNITION-2026-B2" }), courseId);
    expect(courseRepository.create.mock.calls[0][0]).not.toHaveProperty("certificateEnabled");
  });

  it("rejects a second intake without a source course", async () => {
    groupRepository.findById.mockResolvedValue(groupFixture({ courses: [courseFixture()] }));
    await expect(createCourseService({ ...firstInput, intakeKey: "2026-B2" }, actorId)).rejects.toThrow(/copying an existing course/i);
  });

  it("keeps fixed course fields immutable after creation", async () => {
    await expect(updateCourseService(courseId, { certificateEnabled: false }, actorId)).rejects.toMatchObject({ statusCode: 400 });
    expect(courseRepository.updateSetup).not.toHaveBeenCalled();
  });

  it("lets only super admins open an intake", async () => {
    await expect(updateCourseStatusService(courseId, { expectedStatus: "DRAFT", status: "OPEN_ACTIVE" }, { id: actorId, role: "ADMIN" })).rejects.toMatchObject({ statusCode: 403 });
    expect(courseRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it("uses optimistic lifecycle transitions for super admins", async () => {
    courseRepository.transitionStatus.mockResolvedValue(courseFixture({ status: "OPEN_ACTIVE" }));
    const result = await updateCourseStatusService(courseId, { expectedStatus: "DRAFT", status: "OPEN_ACTIVE" }, { id: actorId, role: "SUPER_ADMIN" });
    expect(courseRepository.transitionStatus).toHaveBeenCalledWith(courseId, "DRAFT", "OPEN_ACTIVE");
    expect(result.status).toBe("OPEN_ACTIVE");
  });
});
