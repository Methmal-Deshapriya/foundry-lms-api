import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/catalog/category.repository.js", () => ({ findById: vi.fn() }));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  create: vi.fn(), findById: vi.fn(), update: vi.fn(), setArchived: vi.fn(), remove: vi.fn(), findDeletionImpact: vi.fn(), getAnalytics: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("./publicCatalogCache.service.js", () => ({ revalidatePublicCatalogCache: vi.fn() }));

import * as categoryRepository from "../../../repositories/v1/catalog/category.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";
import { createCourseService, getCourseAnalyticsService, updateCourseService } from "./course.service.js";

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
    // A Course is always publicly served once it exists — see Finding B of
    // the 2026-08-30 system guide/audit.
    expect(revalidatePublicCatalogCache).toHaveBeenCalled();
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

describe("course analytics service", () => {
  beforeEach(() => vi.clearAllMocks());

  function analyticsFixture(overrides = {}) {
    return {
      course: { currency: "LKR", certificateEnabled: true },
      statusGroups: [
        { status: "ACTIVE", _count: 60 },
        { status: "COMPLETED", _count: 30 },
        { status: "CANCELLED", _count: 10 },
      ],
      revenueAgg: { _sum: { amount: 4500000 } },
      paymentTypeGroups: [
        { type: "FULL", _count: 80, _sum: { amount: 4000000 } },
        { type: "PARTIAL", _count: 15, _sum: { amount: 400000 } },
        { type: "TOP_UP", _count: 5, _sum: { amount: 100000 } },
      ],
      projectGroups: [
        { status: "PENDING", _count: 4 },
        { status: "APPROVED", _count: 20 },
        { status: "REJECTED", _count: 2 },
      ],
      certificatesIssuedCount: 28,
      ...overrides,
    };
  }

  it("rolls up enrollments, revenue, and outcomes across every intake of the course", async () => {
    courseRepository.getAnalytics.mockResolvedValue(analyticsFixture());
    const result = await getCourseAnalyticsService(courseId);

    expect(courseRepository.getAnalytics).toHaveBeenCalledWith(courseId);
    expect(result.enrollments).toEqual({ active: 60, completed: 30, cancelled: 10 });
    expect(result.payments).toEqual({
      full: { count: 80, amount: 4000000 },
      partial: { count: 15, amount: 400000 },
      topUp: { count: 5, amount: 100000 },
    });
    expect(result.revenue).toEqual({ total: 4500000, currency: "LKR" });
    expect(result.successRate).toEqual({ completedPct: 30, certificatesIssued: 28, certificateEligible: 30 });
    expect(result.projects).toEqual({ pending: 4, approved: 20, rejected: 2 });
    // Course-level rollup intentionally has no districts/sessionEngagement —
    // curricula can differ between intakes. See §4 of the 2026-08-31 plan.
    expect(result.districts).toBeUndefined();
    expect(result.sessionEngagement).toBeUndefined();
  });

  it("reports certificateEligible as 0 when the course doesn't issue certificates", async () => {
    courseRepository.getAnalytics.mockResolvedValue(
      analyticsFixture({ course: { currency: "LKR", certificateEnabled: false } }),
    );
    const result = await getCourseAnalyticsService(courseId);
    expect(result.successRate.certificateEligible).toBe(0);
  });

  it("reports a null success rate before any enrollment has settled", async () => {
    courseRepository.getAnalytics.mockResolvedValue(
      analyticsFixture({ statusGroups: [{ status: "ACTIVE", _count: 12 }] }),
    );
    const result = await getCourseAnalyticsService(courseId);
    expect(result.successRate.completedPct).toBeNull();
  });

  it("throws NotFoundError for a course that doesn't exist", async () => {
    courseRepository.getAnalytics.mockResolvedValue(null);
    await expect(getCourseAnalyticsService(courseId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
