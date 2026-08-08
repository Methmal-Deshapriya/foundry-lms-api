import * as summaryRepository from "../../../repositories/v1/catalog/learningServiceSummary.repository.js";
import {
  LEARNING_SERVICE_DEFINITIONS,
  getLearningServicePolicy,
} from "../../../constants/v1/catalog/learningServicePolicy.constants.js";

const EMPTY_STATS = Object.freeze({
  categoryTotal: 0,
  categoryPublished: 0,
  categoryDraft: 0,
  categoryArchived: 0,
  courseTotal: 0,
  coursePublished: 0,
  courseDraft: 0,
  courseArchived: 0,
  coursesWithoutSessions: 0,
  curriculumAttachmentCount: 0,
  activeUniqueLearners: 0,
  totalUniqueLearners: 0,
  activeEnrollments: 0,
  paymentAttentionCount: 0,
  enrollingBatchCount: 0,
  activeBatchCount: 0,
  completedBatchCount: 0,
});

export async function getAdminLearningServiceSummariesService() {
  const rows = await summaryRepository.findAdminServiceSummaries();
  const rowsByType = new Map(rows.map((row) => [row.serviceType, row]));

  return {
    services: LEARNING_SERVICE_DEFINITIONS.map((definition) => {
      const stats = { ...EMPTY_STATS, ...rowsByType.get(definition.type) };
      const policy = getLearningServicePolicy(definition.type);
      const attentionCount =
        stats.categoryDraft +
        stats.courseDraft +
        stats.coursesWithoutSessions +
        stats.paymentAttentionCount;

      return {
        serviceType: definition.type,
        serviceSlug: definition.slug,
        label: definition.label,
        description: definition.description,
        deliveryMode: policy.deliveryMode,
        enrollmentMode: policy.enrollmentMode,
        categories: {
          total: stats.categoryTotal,
          published: stats.categoryPublished,
          draft: stats.categoryDraft,
          archived: stats.categoryArchived,
        },
        courses: {
          total: stats.courseTotal,
          published: stats.coursePublished,
          draft: stats.courseDraft,
          archived: stats.courseArchived,
          withoutSessions: stats.coursesWithoutSessions,
        },
        learners: {
          activeUnique: stats.activeUniqueLearners,
          totalUnique: stats.totalUniqueLearners,
          activeEnrollments: stats.activeEnrollments,
        },
        curriculumAttachmentCount: stats.curriculumAttachmentCount,
        batches: policy.requiresBatch
          ? {
              enrolling: stats.enrollingBatchCount,
              active: stats.activeBatchCount,
              completed: stats.completedBatchCount,
            }
          : null,
        payments: policy.requiresCompletedPaymentForAccess
          ? { needsAttention: stats.paymentAttentionCount }
          : null,
        attentionCount,
      };
    }),
  };
}
