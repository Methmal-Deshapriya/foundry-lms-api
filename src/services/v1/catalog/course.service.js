import * as repository from "../../../repositories/v1/catalog/course.repository.js";
import * as learningServiceRepository from "../../../repositories/v1/catalog/learningService.repository.js";
import {
  courseAdminFiltersSchema,
  createCourseSchema,
  updateCourseSchema,
} from "../../../constants/v1/catalog/course.schema.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { COURSE_CURRENCY } from "../../../constants/v1/catalog/catalog.constants.js";
import { toAdminCourse } from "../../../models/v1/catalog/catalog.model.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";
import { assertAttachableStoredObject } from "../storage/storedObject.service.js";

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

function validatePricingPolicy(service, price) {
  const accessType = service.accessType;
  if (accessType === "FREE" && Number(price) !== 0) throw new ValidationError("Free Learning courses must have zero price.", "price");
  if (accessType === "PAID" && Number(price) <= 0) throw new ValidationError("Paid courses must have a price greater than zero.", "price");
}

export async function listCoursesAdminService(query) {
  const { limit, offset, ...filters } = parse(courseAdminFiltersSchema, query);
  const result = await repository.findAdmin(filters, limit, offset);
  return { courses: result.courses.map(toAdminCourse), pagination: { total: result.total, limit, offset } };
}

export async function getCourseAdminService(id) {
  const course = await repository.findById(id);
  if (!course) throw new NotFoundError("Course not found.");
  return toAdminCourse(course);
}

export async function getCourseDeletionImpactService(id) {
  const impact = await repository.findDeletionImpact(id);
  if (!impact) throw new NotFoundError("Course not found.");
  return impact;
}

function countByKey(groups, key, value) {
  return groups.find((row) => row[key] === value)?._count ?? 0;
}

function paymentTypeBreakdown(groups, type) {
  const row = groups.find((entry) => entry.type === type);
  return { count: row?._count ?? 0, amount: row ? Number(row._sum.amount ?? 0) : 0 };
}

/**
 * Cross-intake rollup for the course detail page — total revenue,
 * enrollment outcomes, and certificates across every intake this program
 * has ever run. See the 2026-08-31 course detail page improvement plan §4.
 */
export async function getCourseAnalyticsService(courseId) {
  const data = await repository.getAnalytics(courseId);
  if (!data) throw new NotFoundError("Course not found.");
  const { course, statusGroups, revenueAgg, paymentTypeGroups, projectGroups, certificatesIssuedCount } = data;

  const active = countByKey(statusGroups, "status", "ACTIVE");
  const completed = countByKey(statusGroups, "status", "COMPLETED");
  const cancelled = countByKey(statusGroups, "status", "CANCELLED");
  const successRateDenominator = active + completed + cancelled;
  const hasSettledOutcome = completed + cancelled > 0;

  return {
    enrollments: { active, completed, cancelled },
    payments: {
      full: paymentTypeBreakdown(paymentTypeGroups, "FULL"),
      partial: paymentTypeBreakdown(paymentTypeGroups, "PARTIAL"),
      topUp: paymentTypeBreakdown(paymentTypeGroups, "TOP_UP"),
    },
    revenue: { total: Number(revenueAgg._sum.amount ?? 0), currency: course.currency },
    successRate: {
      completedPct: hasSettledOutcome ? Math.round((completed / successRateDenominator) * 1000) / 10 : null,
      certificatesIssued: certificatesIssuedCount,
      certificateEligible: course.certificateEnabled ? completed : 0,
    },
    projects: {
      pending: countByKey(projectGroups, "status", "PENDING"),
      approved: countByKey(projectGroups, "status", "APPROVED"),
      rejected: countByKey(projectGroups, "status", "REJECTED"),
    },
  };
}

export async function createCourseService(data, actorId) {
  const input = parse(createCourseSchema, data);
  const service = await learningServiceRepository.findById(input.serviceId);
  if (!service) throw new NotFoundError("Learning service not found.");
  if (service.status === "ARCHIVED") throw new ConflictError("Learning service is archived.");
  validatePricingPolicy(service, input.price);
  if (input.thumbnailObjectId) {
    await assertAttachableStoredObject(input.thumbnailObjectId, "COURSE_THUMBNAIL");
  }
  const course = await repository.create({ ...input, currency: COURSE_CURRENCY });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_CREATED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: course.id,
    description: `Course "${course.title}" created as a draft.`,
    metadata: { serviceId: course.serviceId, serviceKey: service.key, intakeCodePrefix: course.intakeCodePrefix },
  });
  // A Course is always publicly served once published (COMING_SOON at
  // minimum) — see the 2026-08-30 system guide/audit, Finding B. It starts
  // as a Draft, so no cache revalidation is needed until it's published.
  return toAdminCourse(course);
}

export async function updateCourseService(id, data, actorId) {
  const input = parse(updateCourseSchema, data);
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  if (input.price !== undefined) validatePricingPolicy(current.service, input.price);
  if (input.thumbnailObjectId) {
    await assertAttachableStoredObject(input.thumbnailObjectId, "COURSE_THUMBNAIL");
  }
  if (input.thumbnailObjectId) input.thumbnailUrl = null;
  if (input.thumbnailUrl) input.thumbnailObjectId = null;
  const course = await repository.update(id, input);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_UPDATED, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Course "${course.title}" updated.`, metadata: { changedFields: Object.keys(input) } });
  if (current.status === "PUBLISHED") {
    await revalidatePublicCatalogCache();
  }
  return toAdminCourse(course);
}

export async function setCoursePublicationService(id, publish, actorId) {
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  if (current.status === "ARCHIVED") throw new ConflictError("Archived courses cannot be published.");
  const course = await repository.setPublication(id, publish);
  recordActionService({
    actorUserId: actorId,
    action: publish ? AUDIT_ACTIONS.COURSE_PUBLISHED : AUDIT_ACTIONS.COURSE_UNPUBLISHED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: id,
    description: `Course "${course.title}" ${publish ? "published" : "unpublished"}.`,
  });
  await revalidatePublicCatalogCache();
  return toAdminCourse(course);
}

export async function setCourseArchivedService(id, archived, actorId) {
  const course = await repository.setArchived(id, archived);
  if (!course) throw new NotFoundError("Course not found.");
  recordActionService({ actorUserId: actorId, action: archived ? AUDIT_ACTIONS.COURSE_ARCHIVED : AUDIT_ACTIONS.COURSE_UNARCHIVED, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Course "${course.title}" ${archived ? "archived" : "restored as a draft"}.` });
  await revalidatePublicCatalogCache();
  return toAdminCourse(course);
}

export async function deleteCourseService(id, actorId) {
  const current = await getCourseAdminService(id);
  const result = await repository.remove(id);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_DELETED_PERMANENTLY, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Unused course "${current.title}" permanently deleted.` });
  return result;
}
