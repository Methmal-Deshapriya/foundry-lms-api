import prisma from "../../../utils/prisma.js";
import { ConflictError, NotFoundError, handlePrismaError } from "../../../utils/Errors.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";

const include = { _count: { select: { courses: true } } };

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

/**
 * Two independent stat blocks: "course" (Draft/Published/Archived — Course's
 * own publish lifecycle, formerly Category's) and "intake" (DRAFT/
 * OPEN_ACTIVE/CLOSED_ACTIVE/COMPLETED/ARCHIVED — an intake's run lifecycle;
 * named "course_*" pre-2026-09-22 back when Category, not Course, owned the
 * publish-status concept — see the 2026-09-22 category layer removal plan).
 */
export async function findAdminSummaries(serviceIds) {
  if (serviceIds.length === 0) return [];
  return prisma.$queryRaw`
    WITH course_status_stats AS (
      SELECT
        course.service_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE course.status = 'PUBLISHED')::int AS published,
        COUNT(*) FILTER (WHERE course.status = 'DRAFT')::int AS draft,
        COUNT(*) FILTER (WHERE course.status = 'ARCHIVED')::int AS archived
      FROM courses course
      WHERE course.service_id = ANY(${serviceIds}::text[])
      GROUP BY course.service_id
    ),
    intake_stats AS (
      SELECT
        intake.service_id,
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
      WHERE intake.service_id = ANY(${serviceIds}::text[])
      GROUP BY intake.service_id
    ),
    curriculum_stats AS (
      SELECT intake.service_id,
        COUNT(course_session.id) FILTER (WHERE course_session.retired_at IS NULL)::int AS attachment_count
      FROM intakes intake
      LEFT JOIN course_sessions course_session ON course_session.intake_id = intake.id
      WHERE intake.service_id = ANY(${serviceIds}::text[])
      GROUP BY intake.service_id
    ),
    learner_stats AS (
      SELECT intake.service_id,
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
      WHERE intake.service_id = ANY(${serviceIds}::text[])
      GROUP BY intake.service_id
    )
    SELECT service.id AS "serviceId",
      COALESCE(course_status.total, 0)::int AS "courseTotal",
      COALESCE(course_status.published, 0)::int AS "coursePublished",
      COALESCE(course_status.draft, 0)::int AS "courseDraft",
      COALESCE(course_status.archived, 0)::int AS "courseArchived",
      COALESCE(intake.total, 0)::int AS "intakeTotal",
      COALESCE(intake.draft, 0)::int AS "intakeDraft",
      COALESCE(intake.open_active, 0)::int AS "openActiveIntakeCount",
      COALESCE(intake.closed_active, 0)::int AS "closedActiveIntakeCount",
      COALESCE(intake.completed, 0)::int AS "completedIntakeCount",
      COALESCE(intake.archived, 0)::int AS "intakeArchived",
      COALESCE(intake.without_sessions, 0)::int AS "intakesWithoutSessions",
      COALESCE(curriculum.attachment_count, 0)::int AS "curriculumAttachmentCount",
      COALESCE(learner.active_unique, 0)::int AS "activeUniqueLearners",
      COALESCE(learner.total_unique, 0)::int AS "totalUniqueLearners",
      COALESCE(learner.active_enrollments, 0)::int AS "activeEnrollments",
      COALESCE(learner.payment_attention, 0)::int AS "paymentAttentionCount"
    FROM learning_services service
    LEFT JOIN course_status_stats course_status ON course_status.service_id = service.id
    LEFT JOIN intake_stats intake ON intake.service_id = service.id
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
      if (current._count.courses > 0 && lockedFields.some((field) => Object.hasOwn(data, field) && data[field] !== current[field])) {
        throw new ConflictError("Learning service identity and policy are immutable after its first course.", "LEARNING_SERVICE_POLICY_LOCKED");
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
        const activeIntakes = await transaction.intake.count({ where: { serviceId: id, status: { in: ["OPEN_ACTIVE", "CLOSED_ACTIVE"] } } });
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
      _count: { select: { courses: true } },
      courses: { select: { _count: { select: { intakes: true } } } },
    },
  });
  if (!service) return null;
  return {
    resourceType: "LEARNING_SERVICE",
    resourceId: id,
    resourceStatus: service.status,
    courses: service._count.courses,
    intakes: service.courses.reduce((sum, course) => sum + course._count.intakes, 0),
    deletable: service.status === "ARCHIVED" && service._count.courses === 0,
  };
}

export async function remove(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `learning-service:${id}`);
      const current = await transaction.learningService.findUnique({ where: { id }, include });
      if (!current) throw new NotFoundError("Learning service not found.");
      if (current.status !== "ARCHIVED") throw new ConflictError("Archive the learning service first.");
      if (current._count.courses > 0) throw new ConflictError("A learning service with courses cannot be permanently deleted.", "CATALOG_DELETION_BLOCKED");
      await transaction.learningService.delete({ where: { id } });
      return { id };
    });
  } catch (error) { throw handlePrismaError(error); }
}
