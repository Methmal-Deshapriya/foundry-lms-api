import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/catalog/intake.repository.js", () => ({
  findById: vi.fn(), transitionStatus: vi.fn(), getAnalytics: vi.fn(), findAdmin: vi.fn(),
}));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({ findById: vi.fn() }));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("./publicCatalogCache.service.js", () => ({ revalidatePublicCatalogCache: vi.fn() }));

import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import { getIntakeAnalyticsService, updateIntakeStatusService } from "./intake.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const intakeId = "90000000-0000-4000-8000-000000000004";

function intakeFixture(overrides = {}) {
  return {
    id: intakeId, code: "AI-ML-IGNITION-2026-1", status: "DRAFT",
    category: { service: {} }, courseId: "course-1", ...overrides,
  };
}

describe("intake lifecycle service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets only super admins open an intake", async () => {
    await expect(updateIntakeStatusService(intakeId, { expectedStatus: "DRAFT", status: "OPEN_ACTIVE" }, { id: actorId, role: "ADMIN" })).rejects.toMatchObject({ statusCode: 403 });
    expect(intakeRepository.transitionStatus).not.toHaveBeenCalled();
  });

  it("uses optimistic lifecycle transitions for super admins", async () => {
    intakeRepository.transitionStatus.mockResolvedValue(intakeFixture({ status: "OPEN_ACTIVE" }));
    const result = await updateIntakeStatusService(intakeId, { expectedStatus: "DRAFT", status: "OPEN_ACTIVE" }, { id: actorId, role: "SUPER_ADMIN" });
    expect(intakeRepository.transitionStatus).toHaveBeenCalledWith(intakeId, "DRAFT", "OPEN_ACTIVE");
    expect(result.status).toBe("OPEN_ACTIVE");
  });
});

describe("intake analytics service", () => {
  beforeEach(() => vi.clearAllMocks());

  function analyticsFixture(overrides = {}) {
    return {
      intake: { capacity: 60, course: { currency: "LKR", certificateEnabled: true } },
      statusGroups: [
        { status: "ACTIVE", _count: 38 },
        { status: "COMPLETED", _count: 4 },
        { status: "CANCELLED", _count: 3 },
      ],
      revenueAgg: { _sum: { amount: 1650000 } },
      paymentTypeGroups: [
        { type: "FULL", _count: 30, _sum: { amount: 1500000 } },
        { type: "PARTIAL", _count: 4, _sum: { amount: 100000 } },
        { type: "TOP_UP", _count: 2, _sum: { amount: 50000 } },
      ],
      districtRows: [{ district: "Colombo", count: 9 }],
      sessionRows: [
        { id: "cs-1", orderIndex: 1, session: { title: "Intro" }, _count: { completions: 30 } },
      ],
      projectGroups: [
        { status: "PENDING", _count: 2 },
        { status: "APPROVED", _count: 5 },
        { status: "REJECTED", _count: 1 },
      ],
      certificatesIssuedCount: 3,
      eligibleEnrollmentCount: 42,
      ...overrides,
    };
  }

  it("shapes the full analytics response from the repository's raw aggregates", async () => {
    intakeRepository.getAnalytics.mockResolvedValue(analyticsFixture());
    const result = await getIntakeAnalyticsService(intakeId);

    expect(result.enrollments).toEqual({ active: 38, completed: 4, cancelled: 3, capacity: 60 });
    expect(result.payments).toEqual({
      full: { count: 30, amount: 1500000 },
      partial: { count: 4, amount: 100000 },
      topUp: { count: 2, amount: 50000 },
    });
    expect(result.revenue).toEqual({ total: 1650000, currency: "LKR" });
    expect(result.successRate).toEqual({ completedPct: 8.9, certificatesIssued: 3, certificateEligible: 4 });
    expect(result.districts).toEqual([{ district: "Colombo", count: 9 }]);
    expect(result.sessionEngagement).toEqual([
      { courseSessionId: "cs-1", title: "Intro", orderIndex: 1, completions: 30, eligible: 42, pct: 71.4 },
    ]);
    expect(result.projects).toEqual({ pending: 2, approved: 5, rejected: 1 });
  });

  it("reports certificateEligible as 0 when the course doesn't issue certificates", async () => {
    intakeRepository.getAnalytics.mockResolvedValue(
      analyticsFixture({ intake: { capacity: 60, course: { currency: "LKR", certificateEnabled: false } } }),
    );
    const result = await getIntakeAnalyticsService(intakeId);
    expect(result.successRate.certificateEligible).toBe(0);
  });

  it("reports a null success rate (not 0%) before any enrollment has settled", async () => {
    intakeRepository.getAnalytics.mockResolvedValue(
      analyticsFixture({ statusGroups: [{ status: "ACTIVE", _count: 5 }] }),
    );
    const result = await getIntakeAnalyticsService(intakeId);
    expect(result.successRate.completedPct).toBeNull();
  });

  it("throws NotFoundError for an intake that doesn't exist", async () => {
    intakeRepository.getAnalytics.mockResolvedValue(null);
    await expect(getIntakeAnalyticsService(intakeId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
