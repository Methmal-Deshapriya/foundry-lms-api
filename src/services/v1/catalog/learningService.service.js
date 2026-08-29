import * as repository from "../../../repositories/v1/catalog/learningService.repository.js";
import {
  createLearningServiceSchema,
  isSupportedLearningServicePolicy,
  learningServiceAdminFiltersSchema,
  learningServiceStatusSchema,
  updateLearningServiceSchema,
} from "../../../constants/v1/catalog/learningService.schema.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";

const EMPTY_STATS = Object.freeze({ categoryTotal: 0, categoryPublished: 0, categoryDraft: 0, categoryArchived: 0, courseTotal: 0, courseDraft: 0, courseArchived: 0, coursesWithoutSessions: 0, curriculumAttachmentCount: 0, activeUniqueLearners: 0, totalUniqueLearners: 0, activeEnrollments: 0, paymentAttentionCount: 0, openActiveCourseCount: 0, closedActiveCourseCount: 0, completedCourseCount: 0 });
const ALLOWED_TRANSITIONS = Object.freeze({ DRAFT: ["ACTIVE", "ARCHIVED"], ACTIVE: ["DRAFT", "ARCHIVED"], ARCHIVED: ["DRAFT"] });

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) { const issue = result.error.issues[0]; throw new ValidationError(issue.message, issue.path[0]); }
  return result.data;
}

function response(service) {
  return { ...service, categoryCount: service._count?.categories ?? service.categoryCount ?? 0, _count: undefined };
}

function withSummary(service, stats = EMPTY_STATS) {
  const values = { ...EMPTY_STATS, ...stats };
  return {
    ...response(service),
    serviceType: service.key,
    serviceSlug: service.slug,
    label: service.title,
    instanceKind: service.courseMode,
    requiresCompletedPaymentForAccess: service.paymentRequirement === "REQUIRED",
    categories: { total: values.categoryTotal, published: values.categoryPublished, draft: values.categoryDraft, archived: values.categoryArchived },
    courses: { total: values.courseTotal, openActive: values.openActiveCourseCount, closedActive: values.closedActiveCourseCount, completed: values.completedCourseCount, draft: values.courseDraft, archived: values.courseArchived, withoutSessions: values.coursesWithoutSessions },
    learners: { activeUnique: values.activeUniqueLearners, totalUnique: values.totalUniqueLearners, activeEnrollments: values.activeEnrollments },
    curriculumAttachmentCount: values.curriculumAttachmentCount,
    payments: service.paymentRequirement === "REQUIRED" ? { needsAttention: values.paymentAttentionCount } : null,
    attentionCount: values.categoryDraft + values.courseDraft + values.coursesWithoutSessions + values.paymentAttentionCount,
  };
}

export async function listLearningServicesService(query = {}) {
  const { limit, offset, ...filters } = parse(learningServiceAdminFiltersSchema, query);
  const result = await repository.findAdmin(filters, limit, offset);
  const summaries = await repository.findAdminSummaries(result.services.map(({ id }) => id));
  const byId = new Map(summaries.map((item) => [item.serviceId, item]));
  return { services: result.services.map((service) => withSummary(service, byId.get(service.id))), pagination: { total: result.total, limit, offset } };
}

export async function listPublicLearningServicesService() {
  return { services: (await repository.findPublic()).map(response) };
}

export async function getLearningServiceService(id) {
  const service = await repository.findById(id);
  if (!service) throw new NotFoundError("Learning service not found.");
  return response(service);
}

export async function createLearningServiceService(data, actorId) {
  const input = parse(createLearningServiceSchema, data);
  const service = await repository.create({ ...input, status: "DRAFT" });
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.LEARNING_SERVICE_CREATED, entityType: ENTITY_TYPES.LEARNING_SERVICE, entityId: service.id, description: `Learning service "${service.title}" created as Draft.`, metadata: { key: service.key, slug: service.slug } });
  return response(service);
}

export async function updateLearningServiceService(id, data, actorId) {
  const input = parse(updateLearningServiceSchema, data);
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Learning service not found.");
  const candidate = { ...current, ...input };
  if (!isSupportedLearningServicePolicy(candidate)) throw new ValidationError("This learning-service policy combination is not supported yet.", "accessType");
  const service = await repository.update(id, input);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.LEARNING_SERVICE_UPDATED, entityType: ENTITY_TYPES.LEARNING_SERVICE, entityId: id, description: `Learning service "${service.title}" updated.`, metadata: { changedFields: Object.keys(input) } });
  if (current.status === "ACTIVE") await revalidatePublicCatalogCache();
  return response(service);
}

export async function transitionLearningServiceStatusService(id, status, data, actorId) {
  const { expectedStatus } = parse(learningServiceStatusSchema, data);
  if (!ALLOWED_TRANSITIONS[expectedStatus]?.includes(status)) throw new ConflictError(`Learning service cannot move from ${expectedStatus} to ${status}.`, "INVALID_LEARNING_SERVICE_TRANSITION");
  const service = await repository.transitionStatus(id, expectedStatus, status);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.LEARNING_SERVICE_STATUS_CHANGED, entityType: ENTITY_TYPES.LEARNING_SERVICE, entityId: id, description: `Learning service "${service.title}" moved from ${expectedStatus} to ${status}.`, metadata: { from: expectedStatus, to: status } });
  await revalidatePublicCatalogCache();
  return response(service);
}

export async function getLearningServiceDeletionImpactService(id) {
  const impact = await repository.findDeletionImpact(id);
  if (!impact) throw new NotFoundError("Learning service not found.");
  return impact;
}

export async function deleteLearningServiceService(id, actorId) {
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Learning service not found.");
  const result = await repository.remove(id);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.LEARNING_SERVICE_DELETED_PERMANENTLY, entityType: ENTITY_TYPES.LEARNING_SERVICE, entityId: id, description: `Unused learning service "${current.title}" permanently deleted.` });
  await revalidatePublicCatalogCache();
  return result;
}

export async function requireLearningServiceBySlugService(slug, { activeOnly = false } = {}) {
  const service = await repository.findBySlug(slug, { activeOnly });
  if (!service) throw new NotFoundError("Learning service not found.");
  return service;
}
