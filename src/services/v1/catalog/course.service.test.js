import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/catalog/learningService.repository.js", () => ({ findById: vi.fn() }));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  create: vi.fn(), findById: vi.fn(), update: vi.fn(), setArchived: vi.fn(), remove: vi.fn(), findDeletionImpact: vi.fn(), getAnalytics: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("./publicCatalogCache.service.js", () => ({ revalidatePublicCatalogCache: vi.fn() }));

import * as learningServiceRepository from "../../../repositories/v1/catalog/learningService.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";
import { createCourseService, getCourseAnalyticsService, updateCourseService } from "./course.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const serviceId = "90000000-0000-4000-8000-000000000003";
const courseId = "90000000-0000-4000-8000-000000000004";

function serviceFixture(overrides = {}) {
  return {
    id: serviceId, key: "BOOTCAMPS", status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL",
    ...overrides,
  };
}

function courseFixture(overrides = {}) {
  return {
    id: courseId, serviceId, slug: "ai-ml-ignition", title: "AI/ML Ignition Program",
    summary: "A practical AI and machine learning program.",
    description: "A practical AI and machine learning program for beginning engineers.",
    level: "BEGINNER", durationValue: 4, durationUnit: "MONTH", price: 1000, currency: "LKR",
    intakeCodePrefix: "AI-ML-IGNITION", certificateEnabled: true, discountAmount: 1000,
    enrollmentStatus: "COMING_SOON", archivedAt: null, status: "DRAFT", service: serviceFixture(),
    _count: { intakes: 0 }, ...overrides,
  };
}

const createInput = {
  serviceId, slug: "ai-ml-ignition", title: "AI/ML Ignition Program",
  summary: "A practical AI and machine learning program.",
  description: "A practical AI and machine learning program for beginning engineers.",
  level: "BEGINNER", durationValue: 4, durationUnit: "MONTH", price: 1000,
  intakeCodePrefix: "AI-ML-IGNITION", certificateEnabled: true,
};

describe("course service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a course with the currency defaulted server-side", async () => {
    learningServiceRepository.findById.mockResolvedValue(serviceFixture());
    courseRepository.create.mockResolvedValue(courseFixture());
    const result = await createCourseService(createInput, actorId);
    expect(courseRepository.create).toHaveBeenCalledWith(expect.objectContaining({ serviceId, title: "AI/ML Ignition Program", currency: "LKR" }));
    expect(result.title).toBe("AI/ML Ignition Program");
    // A newly created Course starts as a Draft, so no cache revalidation is
    // needed until it's explicitly published — see course.service.js.
    expect(revalidatePublicCatalogCache).not.toHaveBeenCalled();
  });

  it("rejects a paid course with a zero price", async () => {
    learningServiceRepository.findById.mockResolvedValue(serviceFixture());
    await expect(createCourseService({ ...createInput, price: 0 }, actorId)).rejects.toMatchObject({ statusCode: 400 });
    expect(courseRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a free-service course with a nonzero price", async () => {
    learningServiceRepository.findById.mockResolvedValue(serviceFixture({ accessType: "FREE" }));
    await expect(createCourseService({ ...createInput, price: 500 }, actorId)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("does not accept certificateEnabled, discountAmount, or intakeCodePrefix on update", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture());
    await expect(updateCourseService(courseId, { certificateEnabled: false }, actorId)).rejects.toMatchObject({ statusCode: 400 });
    expect(courseRepository.update).not.toHaveBeenCalled();
  });
});

describe("editing a published course", () => {
  const admin = { id: actorId, role: "ADMIN" };
  const superAdmin = { id: actorId, role: "SUPER_ADMIN" };
  beforeEach(() => {
    vi.clearAllMocks();
    courseRepository.findById.mockResolvedValue(courseFixture({ status: "PUBLISHED" }));
    courseRepository.update.mockImplementation(async (id, input) => courseFixture({ status: "PUBLISHED", ...input }));
  });

  it("refuses a price change from a regular admin", async () => {
    await expect(updateCourseService(courseId, { price: 500 }, admin)).rejects.toMatchObject({ statusCode: 403, code: "PUBLISHED_COURSE_FIELD_LOCKED" });
    expect(courseRepository.update).not.toHaveBeenCalled();
  });

  it("refuses a link (slug) change from a regular admin", async () => {
    await expect(updateCourseService(courseId, { slug: "new-link" }, admin)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets a regular admin edit the copy, even when the form resends the unchanged price and slug", async () => {
    await updateCourseService(courseId, { summary: "A sharper summary for the live course.", price: 1000, slug: "ai-ml-ignition" }, admin);
    expect(courseRepository.update).toHaveBeenCalled();
    expect(revalidatePublicCatalogCache).toHaveBeenCalled();
  });

  it("lets a super admin change the price", async () => {
    await updateCourseService(courseId, { price: 1500 }, superAdmin);
    expect(courseRepository.update).toHaveBeenCalledWith(courseId, expect.objectContaining({ price: 1500 }));
  });

  it("leaves drafts fully editable by any admin", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture({ status: "DRAFT" }));
    await updateCourseService(courseId, { price: 1500, slug: "renamed" }, admin);
    expect(courseRepository.update).toHaveBeenCalled();
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
      alStreamRows: [{ stream: "Science", count: 12 }],
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
    expect(result.alStreams).toEqual([{ stream: "Science", count: 12 }]);
    // Course-level rollup intentionally has no districts/sessionEngagement —
    // curricula can differ between intakes. See §4 of the 2026-08-31 plan.
    // A/L stream is a student attribute, not a curriculum one, so it does
    // aggregate across intakes.
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
