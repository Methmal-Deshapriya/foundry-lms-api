import { beforeEach, describe, expect, it, vi } from "vitest";
import * as summaryRepository from "../../../repositories/v1/catalog/learningServiceSummary.repository.js";
import { getAdminLearningServiceSummariesService } from "./learningServiceSummary.service.js";

vi.mock(
  "../../../repositories/v1/catalog/learningServiceSummary.repository.js",
  () => ({ findAdminServiceSummaries: vi.fn() }),
);

describe("learning-service administration summaries", () => {
  beforeEach(() => {
    vi.mocked(summaryRepository.findAdminServiceSummaries).mockReset();
  });

  it("always returns every fixed learning service with zero-safe counts", async () => {
    vi.mocked(summaryRepository.findAdminServiceSummaries).mockResolvedValue([]);

    const result = await getAdminLearningServiceSummariesService();

    expect(result.services.map((service) => service.serviceType)).toEqual([
      "BOOTCAMPS",
      "PRETECH",
      "FREE_LEARNING",
    ]);
    expect(result.services[0]).toMatchObject({
      categories: { total: 0, published: 0, draft: 0, archived: 0 },
      courses: { total: 0, published: 0, draft: 0, archived: 0 },
      learners: { activeUnique: 0, totalUnique: 0, activeEnrollments: 0 },
      batches: { enrolling: 0, active: 0, completed: 0 },
      attentionCount: 0,
    });
    expect(result.services[2].batches).toBeNull();
    expect(result.services[2].payments).toBeNull();
  });

  it("maps aggregates and calculates actionable attention items", async () => {
    vi.mocked(summaryRepository.findAdminServiceSummaries).mockResolvedValue([
      {
        serviceType: "BOOTCAMPS",
        categoryTotal: 5,
        categoryPublished: 3,
        categoryDraft: 1,
        categoryArchived: 1,
        courseTotal: 8,
        coursePublished: 5,
        courseDraft: 2,
        courseArchived: 1,
        coursesWithoutSessions: 2,
        curriculumAttachmentCount: 14,
        activeUniqueLearners: 40,
        totalUniqueLearners: 56,
        activeEnrollments: 44,
        paymentAttentionCount: 3,
        enrollingBatchCount: 1,
        activeBatchCount: 2,
        completedBatchCount: 4,
      },
    ]);

    const result = await getAdminLearningServiceSummariesService();

    expect(result.services[0]).toMatchObject({
      serviceSlug: "bootcamps",
      deliveryMode: "COHORT",
      categories: { total: 5, published: 3, draft: 1, archived: 1 },
      courses: { total: 8, published: 5, draft: 2, archived: 1, withoutSessions: 2 },
      learners: { activeUnique: 40, totalUnique: 56, activeEnrollments: 44 },
      batches: { enrolling: 1, active: 2, completed: 4 },
      payments: { needsAttention: 3 },
      attentionCount: 8,
    });
  });
});
