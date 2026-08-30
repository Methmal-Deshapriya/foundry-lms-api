import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = { _count: { select: { categories: true } } };

export function findById(id) {
  return prisma.learningService.findUnique({ where: { id }, include });
}

export function findBySlug(slug, { activeOnly = false } = {}) {
  return prisma.learningService.findFirst({ where: { slug, ...(activeOnly ? { status: "ACTIVE" } : {}) }, include });
}

export function findByKey(key) {
  return prisma.learningService.findUnique({ where: { key }, include });
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.status
      ? { status: filters.status }
      : !filters.includeArchived
        ? { status: { not: "ARCHIVED" } }
        : {}),
    ...(filters.q ? { OR: [
      { key: { contains: filters.q, mode: "insensitive" } },
      { slug: { contains: filters.q, mode: "insensitive" } },
      { title: { contains: filters.q, mode: "insensitive" } },
    ] } : {}),
  };
  const [total, services] = await Promise.all([
    prisma.learningService.count({ where }),
    prisma.learningService.findMany({ where, orderBy: [{ sortOrder: "asc" }, { title: "asc" }], take: limit, skip: offset, include }),
  ]);
  return { total, services };
}

export function findPublic() {
  return prisma.learningService.findMany({ where: { status: "ACTIVE" }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }] });
}

export async function findAdminSummaries(serviceIds) {
  if (serviceIds.length === 0) return [];
  return prisma.$queryRaw`
    WITH category_stats AS (
      SELECT
        category.service_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE category.status = 'PUBLISHED')::int AS published,
        COUNT(*) FILTER (WHERE category.status = 'DRAFT')::int AS draft,
        COUNT(*) FILTER (WHERE category.status = 'ARCHIVED')::int AS archived
      FROM categories category
      WHERE category.service_id = ANY(${serviceIds}::text[])
      GROUP BY category.service_id
    ),
    course_stats AS (
      -- Lifecycle status lives on Intake, not the new Course/program table —
      -- see the 2026-08-30 rename plan. Column names in this CTE stay
      -- "course_*" since they're only ever consumed as the courseTotal/
      -- courseDraft/etc. fields below, unchanged for existing consumers.
      SELECT
        category.service_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE intake.status = 'DRAFT')::int AS draft,
        COUNT(*) FILTER (WHERE intake.status = 'OPEN_ACTIVE')::int AS open_active,
        COUNT(*) FILTER (WHERE intake.status = 'CLOSED_ACTIVE')::int AS closed_active,
        COUNT(*) FILTER (WHERE intake.status = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE intake.status = 'ARCHIVED')::int AS archived,
        COUNT(*) FILTER (
          WHERE intake.status <> 'ARCHIVED'
            AND NOT EXISTS (
              SELECT 1 FROM course_sessions course_session
              WHERE course_session.intake_id = intake.id
                AND course_session.retired_at IS NULL
            )
        )::int AS without_sessions
      FROM intakes intake
      JOIN categories category ON category.id = intake.category_id
      WHERE category.service_id = ANY(${serviceIds}::text[])
      GROUP BY category.service_id
    ),
    curriculum_stats AS (
      SELECT category.service_id,
        COUNT(course_session.id) FILTER (WHERE course_session.retired_at IS NULL)::int AS attachment_count
      FROM intakes intake
      JOIN categories category ON category.id = intake.category_id
      LEFT JOIN course_sessions course_session ON course_session.intake_id = intake.id
      WHERE category.service_id = ANY(${serviceIds}::text[])
      GROUP BY category.service_id
    ),
    learner_stats AS (
      SELECT category.service_id,
        COUNT(DISTINCT enrollment.user_id) FILTER (WHERE enrollment.status = 'ACTIVE')::int AS active_unique,
        COUNT(DISTINCT enrollment.user_id)::int AS total_unique,
        COUNT(*) FILTER (WHERE enrollment.status = 'ACTIVE')::int AS active_enrollments,
        -- PENDING no longer exists on PaymentStatus (removed by the payment
        -- ledger migration) — PARTIAL is the only remaining "not yet fully
        -- paid" state left to flag here.
        COUNT(*) FILTER (
          WHERE enrollment.status = 'ACTIVE'
            AND enrollment.payment_status = 'PARTIAL'
        )::int AS payment_attention
      FROM enrollments enrollment
      JOIN intakes intake ON intake.id = enrollment.intake_id
      JOIN categories category ON category.id = intake.category_id
      WHERE category.service_id = ANY(${serviceIds}::text[])
      GROUP BY category.service_id
    )
    SELECT service.id AS "serviceId",
      COALESCE(category.total, 0)::int AS "categoryTotal",
      COALESCE(category.published, 0)::int AS "categoryPublished",
      COALESCE(category.draft, 0)::int AS "categoryDraft",
      COALESCE(category.archived, 0)::int AS "categoryArchived",
      COALESCE(course.total, 0)::int AS "courseTotal",
      COALESCE(course.draft, 0)::int AS "courseDraft",
      COALESCE(course.open_active, 0)::int AS "openActiveCourseCount",
      COALESCE(course.closed_active, 0)::int AS "closedActiveCourseCount",
      COALESCE(course.completed, 0)::int AS "completedCourseCount",
      COALESCE(course.archived, 0)::int AS "courseArchived",
      COALESCE(course.without_sessions, 0)::int AS "coursesWithoutSessions",
      COALESCE(curriculum.attachment_count, 0)::int AS "curriculumAttachmentCount",
      COALESCE(learner.active_unique, 0)::int AS "activeUniqueLearners",
      COALESCE(learner.total_unique, 0)::int AS "totalUniqueLearners",
      COALESCE(learner.active_enrollments, 0)::int AS "activeEnrollments",
      COALESCE(learner.payment_attention, 0)::int AS "paymentAttentionCount"
    FROM learning_services service
    LEFT JOIN category_stats category ON category.service_id = service.id
    LEFT JOIN course_stats course ON course.service_id = service.id
    LEFT JOIN curriculum_stats curriculum ON curriculum.service_id = service.id
    LEFT JOIN learner_stats learner ON learner.service_id = service.id
    WHERE service.id = ANY(${serviceIds}::text[])
  `;
}

export async function create(data) {
  try { return await prisma.learningService.create({ data, include }); }
  catch (error) { throw handlePrismaError(error); }
}

export async function update(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `learning-service:${id}`);
      const current = await transaction.learningService.findUnique({ where: { id }, include });
      if (!current) throw new NotFoundError("Learning service not found.");
      if (current.status === "ARCHIVED") throw new ConflictError("Archived learning services are read-only.");
      const lockedFields = ["slug", "accessType", "courseMode", "enrollmentMode", "paymentRequirement"];
      if (current._count.categories > 0 && lockedFields.some((field) => Object.hasOwn(data, field) && data[field] !== current[field])) {
        throw new ConflictError("Learning service identity and policy are immutable after its first category.", "LEARNING_SERVICE_POLICY_LOCKED");
      }
      return transaction.learningService.update({ where: { id }, data, include });
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function transitionStatus(id, expectedStatus, status) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `learning-service:${id}`);
      const current = await transaction.learningService.findUnique({ where: { id }, include });
      if (!current) throw new NotFoundError("Learning service not found.");
      if (current.status !== expectedStatus) throw new ConflictError("Learning service status changed. Refresh and try again.", "STALE_LEARNING_SERVICE_STATUS");
      if (status === "ARCHIVED") {
        const activeIntakes = await transaction.intake.count({ where: { category: { serviceId: id }, status: { in: ["OPEN_ACTIVE", "CLOSED_ACTIVE"] } } });
        if (activeIntakes > 0) throw new ConflictError("Complete or cancel every active intake before archiving this learning service.", "LEARNING_SERVICE_ARCHIVE_BLOCKED");
      }
      return transaction.learningService.update({ where: { id }, data: { status }, include });
    });
  } catch (error) { throw handlePrismaError(error); }
}

export async function findDeletionImpact(id) {
  const service = await prisma.learningService.findUnique({
    where: { id },
    include: {
      _count: { select: { categories: true } },
      categories: { select: { _count: { select: { courses: true, intakes: true } } } },
    },
  });
  if (!service) return null;
  return {
    resourceType: "LEARNING_SERVICE",
    resourceId: id,
    resourceStatus: service.status,
    categories: service._count.categories,
    courses: service.categories.reduce((sum, category) => sum + category._count.courses, 0),
    intakes: service.categories.reduce((sum, category) => sum + category._count.intakes, 0),
    deletable: service.status === "ARCHIVED" && service._count.categories === 0,
  };
}

export async function remove(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `learning-service:${id}`);
      const current = await transaction.learningService.findUnique({ where: { id }, include });
      if (!current) throw new NotFoundError("Learning service not found.");
      if (current.status !== "ARCHIVED") throw new ConflictError("Archive the learning service first.");
      if (current._count.categories > 0) throw new ConflictError("A learning service with categories cannot be permanently deleted.", "CATALOG_DELETION_BLOCKED");
      await transaction.learningService.delete({ where: { id } });
      return { id };
    });
  } catch (error) { throw handlePrismaError(error); }
}
