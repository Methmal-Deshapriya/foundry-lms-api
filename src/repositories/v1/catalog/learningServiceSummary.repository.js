import prisma from "../../../utils/prisma.js";

/**
 * Returns one bounded aggregate row per fixed learning service.
 *
 * The CTEs aggregate each relationship independently before joining them.
 * This avoids inflated counts from joining categories, courses, enrollments,
 * batches, and curriculum attachments into one multiplied result set.
 */
export async function findAdminServiceSummaries() {
  return prisma.$queryRaw`
    WITH services (ordinal, service_type) AS (
      VALUES
        (1, 'BOOTCAMPS'::"LearningServiceType"),
        (2, 'PRETECH'::"LearningServiceType"),
        (3, 'FREE_LEARNING'::"LearningServiceType")
    ),
    category_stats AS (
      SELECT
        "service_type",
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'PUBLISHED')::int AS published,
        COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
        COUNT(*) FILTER (WHERE status = 'ARCHIVED')::int AS archived
      FROM categories
      GROUP BY "service_type"
    ),
    course_stats AS (
      SELECT
        category."service_type",
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE course.status = 'PUBLISHED')::int AS published,
        COUNT(*) FILTER (WHERE course.status = 'DRAFT')::int AS draft,
        COUNT(*) FILTER (WHERE course.status = 'ARCHIVED')::int AS archived,
        COUNT(*) FILTER (
          WHERE course.status <> 'ARCHIVED'
            AND NOT EXISTS (
              SELECT 1
              FROM course_sessions course_session
              WHERE course_session."course_id" = course.id
                AND course_session."retired_at" IS NULL
            )
        )::int AS without_sessions
      FROM courses course
      JOIN categories category ON category.id = course."category_id"
      GROUP BY category."service_type"
    ),
    curriculum_stats AS (
      SELECT
        category."service_type",
        COUNT(course_session.id) FILTER (
          WHERE course_session."retired_at" IS NULL
        )::int AS attachment_count
      FROM courses course
      JOIN categories category ON category.id = course."category_id"
      LEFT JOIN course_sessions course_session
        ON course_session."course_id" = course.id
      GROUP BY category."service_type"
    ),
    learner_stats AS (
      SELECT
        category."service_type",
        COUNT(DISTINCT enrollment."user_id") FILTER (
          WHERE enrollment.status = 'ACTIVE'
        )::int AS active_unique,
        COUNT(DISTINCT enrollment."user_id")::int AS total_unique,
        COUNT(*) FILTER (WHERE enrollment.status = 'ACTIVE')::int AS active_enrollments,
        COUNT(*) FILTER (
          WHERE enrollment.status = 'ACTIVE'
            AND enrollment."payment_status" IN ('PENDING', 'PARTIAL')
        )::int AS payment_attention
      FROM enrollments enrollment
      JOIN courses course ON course.id = enrollment."course_id"
      JOIN categories category ON category.id = course."category_id"
      GROUP BY category."service_type"
    ),
    batch_stats AS (
      SELECT
        category."service_type",
        COUNT(*) FILTER (WHERE batch.status = 'ENROLLING')::int AS enrolling,
        COUNT(*) FILTER (WHERE batch.status = 'ACTIVE')::int AS active,
        COUNT(*) FILTER (WHERE batch.status = 'COMPLETED')::int AS completed
      FROM batches batch
      JOIN courses course ON course.id = batch."course_id"
      JOIN categories category ON category.id = course."category_id"
      GROUP BY category."service_type"
    )
    SELECT
      service.service_type::text AS "serviceType",
      COALESCE(category.total, 0)::int AS "categoryTotal",
      COALESCE(category.published, 0)::int AS "categoryPublished",
      COALESCE(category.draft, 0)::int AS "categoryDraft",
      COALESCE(category.archived, 0)::int AS "categoryArchived",
      COALESCE(course.total, 0)::int AS "courseTotal",
      COALESCE(course.published, 0)::int AS "coursePublished",
      COALESCE(course.draft, 0)::int AS "courseDraft",
      COALESCE(course.archived, 0)::int AS "courseArchived",
      COALESCE(course.without_sessions, 0)::int AS "coursesWithoutSessions",
      COALESCE(curriculum.attachment_count, 0)::int AS "curriculumAttachmentCount",
      COALESCE(learner.active_unique, 0)::int AS "activeUniqueLearners",
      COALESCE(learner.total_unique, 0)::int AS "totalUniqueLearners",
      COALESCE(learner.active_enrollments, 0)::int AS "activeEnrollments",
      COALESCE(learner.payment_attention, 0)::int AS "paymentAttentionCount",
      COALESCE(batch.enrolling, 0)::int AS "enrollingBatchCount",
      COALESCE(batch.active, 0)::int AS "activeBatchCount",
      COALESCE(batch.completed, 0)::int AS "completedBatchCount"
    FROM services service
    LEFT JOIN category_stats category
      ON category."service_type" = service.service_type
    LEFT JOIN course_stats course
      ON course."service_type" = service.service_type
    LEFT JOIN curriculum_stats curriculum
      ON curriculum."service_type" = service.service_type
    LEFT JOIN learner_stats learner
      ON learner."service_type" = service.service_type
    LEFT JOIN batch_stats batch
      ON batch."service_type" = service.service_type
    ORDER BY service.ordinal
  `;
}
