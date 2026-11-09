import { beforeEach, describe, expect, it, vi } from "vitest";

// Code review M06-16: the catalog's riskiest rules, pinned.

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    course: { findUnique: vi.fn(), update: vi.fn() },
    intake: { count: vi.fn() },
    learningService: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      course: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
    },
  };
});
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("./publicCatalogCache.service.js", () => ({ revalidatePublicCatalogCache: vi.fn() }));

import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import * as serviceRepository from "../../../repositories/v1/catalog/learningService.repository.js";
import { createCourseSchema, courseAdminFiltersSchema, updateCourseSchema } from "../../../constants/v1/catalog/course.schema.js";
import { createLearningServiceSchema } from "../../../constants/v1/catalog/learningService.schema.js";

const baseCourse = {
  serviceId: "90000000-0000-4000-8000-000000000003",
  slug: "ai-ml",
  title: "AI and ML",
  summary: "A practical AI and machine learning program.",
  description: "A practical AI and machine learning program for beginners.",
  level: "BEGINNER",
  price: 60000,
  intakeCodePrefix: "AI-ML",
  certificateEnabled: true,
};

describe("public course queries never show drafts, archived courses or inactive services", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters the service page", async () => {
    await courseRepository.findPublicByService("s-1");
    expect(mocks.prisma.course.findMany.mock.calls[0][0].where).toMatchObject({ status: "PUBLISHED", archivedAt: null, service: { status: "ACTIVE" } });
  });

  it("filters the course detail", async () => {
    await courseRepository.findPublicDetail("s-1", "ai-ml");
    expect(mocks.prisma.course.findFirst.mock.calls[0][0].where).toMatchObject({ status: "PUBLISHED", archivedAt: null });
  });
});

describe("full-payment discount (M06-02)", () => {
  it("must be less than the price", () => {
    expect(createCourseSchema.safeParse({ ...baseCourse, discountAmount: 60000 }).success).toBe(false);
    expect(createCourseSchema.safeParse({ ...baseCourse, discountAmount: 50000 }).success).toBe(true);
    expect(createCourseSchema.safeParse({ ...baseCourse, discountAmount: 0 }).success).toBe(true);
  });
});

describe("query and URL parsing", () => {
  it("reads includeArchived=false as false (M06-12)", () => {
    expect(courseAdminFiltersSchema.parse({ includeArchived: "false" }).includeArchived).toBe(false);
    expect(courseAdminFiltersSchema.parse({ includeArchived: "true" }).includeArchived).toBe(true);
    expect(courseAdminFiltersSchema.parse({}).includeArchived).toBe(false);
  });

  it("answers a malformed video URL with a validation error, not a crash (M06-07)", () => {
    const result = updateCourseSchema.safeParse({ explainerVideoUrl: "not a url" });
    expect(result.success).toBe(false);
    expect(updateCourseSchema.safeParse({ explainerVideoUrl: "https://example.com/watch" }).success).toBe(false);
    expect(updateCourseSchema.safeParse({ explainerVideoUrl: "https://youtu.be/abc123" }).success).toBe(true);
  });
});

describe("service slugs (M06-09)", () => {
  it.each(["explore", "admin", "sign-in", "projects", "certificates", "students", "api"])("refuses the reserved address %s", (slug) => {
    const result = createLearningServiceSchema.safeParse({ slug });
    const slugIssue = result.success ? null : result.error.issues.find((issue) => issue.path[0] === "slug");
    expect(slugIssue).toBeTruthy();
  });
});

describe("unpublishing while an intake is open (M06-03)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to unpublish a course with an open intake", async () => {
    mocks.transaction.course.findUnique
      .mockResolvedValueOnce({ serviceId: "s-1" })
      .mockResolvedValueOnce({ id: "c-1", status: "PUBLISHED", service: { status: "ACTIVE" } });
    mocks.transaction.intake.count.mockResolvedValueOnce(1);
    await expect(courseRepository.setPublication("c-1", false)).rejects.toMatchObject({ code: "COURSE_HAS_OPEN_INTAKE" });
    expect(mocks.transaction.course.update).not.toHaveBeenCalled();
  });

  it("refuses to move a service with an open intake back to draft", async () => {
    mocks.transaction.learningService.findUnique.mockResolvedValueOnce({ id: "s-1", status: "ACTIVE" });
    mocks.transaction.intake.count.mockResolvedValueOnce(2);
    await expect(serviceRepository.transitionStatus("s-1", "ACTIVE", "DRAFT")).rejects.toMatchObject({ code: "LEARNING_SERVICE_HAS_OPEN_INTAKE" });
    expect(mocks.transaction.learningService.update).not.toHaveBeenCalled();
  });
});
