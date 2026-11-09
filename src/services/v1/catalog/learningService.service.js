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
import { publicObjectUrl } from "../../../config/r2.js";
import { toStoredObjectSummary } from "../../../utils/thumbnails.js";
import { assertAttachableStoredObject } from "../storage/storedObject.service.js";
import { COURSE_CURRENCY } from "../../../constants/v1/catalog/catalog.constants.js";

const EMPTY_STATS = Object.freeze({
  courseTotal: 0, coursePublished: 0, courseDraft: 0, courseArchived: 0,
  intakeTotal: 0, intakeDraft: 0, intakeArchived: 0, intakesWithoutSessions: 0,
  curriculumAttachmentCount: 0, activeUniqueLearners: 0, totalUniqueLearners: 0, activeEnrollments: 0,
  paymentAttentionCount: 0, openActiveIntakeCount: 0, closedActiveIntakeCount: 0, completedIntakeCount: 0,
  revenueTotal: 0,
  paymentFullCount: 0, paymentFullAmount: 0, paymentPartialCount: 0, paymentPartialAmount: 0, paymentTopUpCount: 0, paymentTopUpAmount: 0,
  certificatesIssued: 0, certificatesEligible: 0,
  projectsPending: 0, projectsApproved: 0, projectsRejected: 0,
});
const ALLOWED_TRANSITIONS = Object.freeze({ DRAFT: ["ACTIVE", "ARCHIVED"], ACTIVE: ["DRAFT", "ARCHIVED"], ARCHIVED: ["DRAFT"] });

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) { const issue = result.error.issues[0]; throw new ValidationError(issue.message, issue.path[0]); }
  return result.data;
}

function resolveObjectUrl(object) {
  return object?.status === "READY" ? publicObjectUrl(object.objectKey) : null;
}

function response(service) {
  const heroImageUrl = resolveObjectUrl(service.heroImageObject);
  const cardImageUrl = resolveObjectUrl(service.cardImageObject);
  return {
    ...service,
    courseCount: service._count?.courses ?? service.courseCount ?? 0,
    _count: undefined,
    heroImageUrl,
    heroImageObject: toStoredObjectSummary(service.heroImageObject, heroImageUrl),
    cardImageUrl,
    cardImageObject: toStoredObjectSummary(service.cardImageObject, cardImageUrl),
  };
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
    courses: { total: values.courseTotal, published: values.coursePublished, draft: values.courseDraft, archived: values.courseArchived },
    intakes: { total: values.intakeTotal, openActive: values.openActiveIntakeCount, closedActive: values.closedActiveIntakeCount, completed: values.completedIntakeCount, draft: values.intakeDraft, archived: values.intakeArchived, withoutSessions: values.intakesWithoutSessions },
    learners: { activeUnique: values.activeUniqueLearners, totalUnique: values.totalUniqueLearners, activeEnrollments: values.activeEnrollments },
    curriculumAttachmentCount: values.curriculumAttachmentCount,
    payments: service.paymentRequirement === "REQUIRED" ? { needsAttention: values.paymentAttentionCount } : null,
    attentionCount: values.courseDraft + values.intakeDraft + values.intakesWithoutSessions + values.paymentAttentionCount,
    // Revenue/payments/certificates/projects — see the 2026-09-24
    // hierarchical admin summaries plan. Amount columns come back from
    // $queryRaw as numeric strings (Postgres `numeric`, not `int`), hence
    // the explicit Number(...) here — the same conversion
    // getCourseAnalyticsService/getIntakeAnalyticsService already do for
    // Prisma's own Decimal aggregate results.
    revenue: { total: Number(values.revenueTotal), currency: COURSE_CURRENCY },
    paymentBreakdown: {
      full: { count: values.paymentFullCount, amount: Number(values.paymentFullAmount) },
      partial: { count: values.paymentPartialCount, amount: Number(values.paymentPartialAmount) },
      topUp: { count: values.paymentTopUpCount, amount: Number(values.paymentTopUpAmount) },
    },
    certificates: { issued: values.certificatesIssued, eligible: values.certificatesEligible },
    projects: { pending: values.projectsPending, approved: values.projectsApproved, rejected: values.projectsRejected },
  };
}

export async function listLearningServicesService(query = {}) {
  const { limit, offset, ...filters } = parse(learningServiceAdminFiltersSchema, query);
  const result = await repository.findAdmin(filters, limit, offset);
  const summaries = await repository.findAdminSummaries(result.services.map(({ id }) => id));
  const byId = new Map(summaries.map((item) => [item.serviceId, item]));
  return { services: result.services.map((service) => withSummary(service, byId.get(service.id))), pagination: { total: result.total, limit, offset } };
}

// The public shape: exactly the fields the public site renders, nothing
// else. Unlike the admin response, a column added to LearningService later
// never becomes public by accident (code review M06-05).
function toPublicLearningService(service) {
  return {
    id: service.id,
    key: service.key,
    slug: service.slug,
    title: service.title,
    description: service.description,
    accessType: service.accessType,
    courseMode: service.courseMode,
    enrollmentMode: service.enrollmentMode,
    paymentRequirement: service.paymentRequirement,
    sortOrder: service.sortOrder,
    courseCount: service._count?.courses ?? service.courseCount ?? 0,
    summary: service.summary ?? null,
    heroHeadline: service.heroHeadline ?? null,
    heroTags: service.heroTags ?? [],
    cardImageUrl: resolveObjectUrl(service.cardImageObject),
    heroImageUrl: resolveObjectUrl(service.heroImageObject),
    processSteps: service.processSteps ?? [],
    faqItems: service.faqItems ?? [],
  };
}

export async function listPublicLearningServicesService() {
  return { services: (await repository.findPublic()).map(toPublicLearningService) };
}

export async function getLearningServiceService(id) {
  const service = await repository.findById(id);
  if (!service) throw new NotFoundError("Learning service not found.");
  return response(service);
}

export async function createLearningServiceService(data, actorId) {
  const input = parse(createLearningServiceSchema, data);
  await assertAttachableStoredObject(input.heroImageObjectId, "SERVICE_HERO");
  await assertAttachableStoredObject(input.cardImageObjectId, "SERVICE_CARD");
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
  if (input.heroImageObjectId) {
    await assertAttachableStoredObject(input.heroImageObjectId, "SERVICE_HERO");
  }
  if (input.cardImageObjectId) {
    await assertAttachableStoredObject(input.cardImageObjectId, "SERVICE_CARD");
  }
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
