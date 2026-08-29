import * as categoryRepo from "../../../repositories/v1/catalog/category.repository.js";
import {
  categoryAdminFiltersSchema,
  createCategorySchema,
  updateCategorySchema,
} from "../../../constants/v1/catalog/category.schema.js";
import { CATALOG_STATUSES } from "../../../constants/v1/catalog/catalog.constants.js";
import { toAdminCategory } from "../../../models/v1/catalog/catalog.model.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";
import * as learningServiceRepository from "../../../repositories/v1/catalog/learningService.repository.js";

function parseOrThrow(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return validation.data;
}

export async function getCategoriesAdminService(query) {
  const filters = parseOrThrow(categoryAdminFiltersSchema, query);
  const { limit, offset, ...where } = filters;
  const result = await categoryRepo.findAdmin(where, limit, offset);
  return {
    categories: result.categories.map(toAdminCategory),
    pagination: { total: result.total, limit, offset },
  };
}

export async function getCategoryAdminService(id) {
  const category = await categoryRepo.findById(id);
  if (!category) throw new NotFoundError("Category not found.");
  return toAdminCategory(category);
}

export async function getCategoryDeletionImpactService(id) {
  const impact = await categoryRepo.findDeletionImpact(id);
  if (!impact) throw new NotFoundError("Category not found.");
  return impact;
}

export async function createCategoryService(data, actorId) {
  const input = parseOrThrow(createCategorySchema, data);
  const learningService = await learningServiceRepository.findById(input.serviceId);
  if (!learningService) throw new NotFoundError("Learning service not found.");
  if (learningService.status === "ARCHIVED") throw new ConflictError("Learning service is archived.");
  const category = await categoryRepo.create({
    ...input,
    status: CATALOG_STATUSES.DRAFT,
  });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.CATEGORY_CREATED,
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: category.id,
    description: `Category "${category.title}" created as a draft.`,
    metadata: { serviceId: category.serviceId, serviceKey: learningService.key, slug: category.slug },
  });
  return toAdminCategory(category);
}

export async function updateCategoryService(id, data, actorId) {
  if (Object.hasOwn(data, "serviceId")) {
    throw new ConflictError(
      "A category's learning service is selected at creation and cannot be changed later.",
    );
  }
  const input = parseOrThrow(updateCategorySchema, data);
  const current = await categoryRepo.findById(id);
  if (!current) throw new NotFoundError("Category not found.");
  if (current.status === CATALOG_STATUSES.ARCHIVED) {
    throw new ConflictError("Archived categories cannot be edited.");
  }
  if (
    current.status === CATALOG_STATUSES.PUBLISHED &&
    (input.slug !== undefined || input.serviceId !== undefined)
  ) {
    throw new ConflictError(
      "Published category slugs and services are immutable. Unpublish it first.",
    );
  }
  const category = await categoryRepo.updateOperational(id, input);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.CATEGORY_UPDATED,
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: id,
    description: `Category "${category.title}" updated.`,
    metadata: { changedFields: Object.keys(input) },
  });
  if (current.status === CATALOG_STATUSES.PUBLISHED) {
    await revalidatePublicCatalogCache();
  }
  return toAdminCategory(category);
}

export async function setCategoryPublicationService(id, publish, actorId) {
  const current = await categoryRepo.findById(id);
  if (!current) throw new NotFoundError("Category not found.");
  if (current.status === CATALOG_STATUSES.ARCHIVED) {
    throw new ConflictError("Archived categories cannot be published.");
  }
  const category = await categoryRepo.setPublication(id, publish);
  recordActionService({
    actorUserId: actorId,
    action: publish
      ? AUDIT_ACTIONS.CATEGORY_PUBLISHED
      : AUDIT_ACTIONS.CATEGORY_UNPUBLISHED,
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: id,
    description: `Category "${category.title}" ${publish ? "published" : "unpublished"}.`,
  });
  await revalidatePublicCatalogCache();
  return toAdminCategory(category);
}

export async function archiveCategoryService(id, actorId) {
  const current = await categoryRepo.findById(id);
  if (!current) throw new NotFoundError("Category not found.");
  if (current.status === CATALOG_STATUSES.ARCHIVED) return toAdminCategory(current);
  const result = await categoryRepo.archiveSafely(id);
  if (!result) throw new NotFoundError("Category not found.");
  const { category, archivedCourseGroupCount } = result;
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.CATEGORY_ARCHIVED,
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: id,
    description: `Category "${category.title}" and its course groups archived.`,
    metadata: { archivedCourseGroupCount },
  });
  if (current.status === CATALOG_STATUSES.PUBLISHED) {
    await revalidatePublicCatalogCache();
  }
  return toAdminCategory(category);
}

export async function unarchiveCategoryService(id, actorId) {
  const current = await categoryRepo.findById(id);
  if (!current) throw new NotFoundError("Category not found.");
  if (current.status !== CATALOG_STATUSES.ARCHIVED) {
    throw new ConflictError("Only archived categories can be restored.");
  }

  const category = await categoryRepo.restore(id);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.CATEGORY_UNARCHIVED,
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: id,
    description: `Category "${category.title}" restored as a draft. Child course groups remain archived until restored explicitly.`,
  });
  return toAdminCategory(category);
}

export async function deleteCategoryPermanentlyService(id, actorId) {
  const current = await categoryRepo.findById(id);
  if (!current) throw new NotFoundError("Category not found.");
  if (current.status !== CATALOG_STATUSES.ARCHIVED) {
    throw new ConflictError(
      "Archive the category before permanently deleting it.",
    );
  }

  const result = await categoryRepo.removePermanently(id);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.CATEGORY_DELETED_PERMANENTLY,
    entityType: ENTITY_TYPES.CATEGORY,
    entityId: id,
    description: `Unused category "${current.title}" and its catalog setup permanently deleted.`,
    metadata: {
      title: current.title,
      slug: current.slug,
      serviceId: current.serviceId,
      serviceKey: current.service.key,
      ...result,
    },
  });
  await revalidatePublicCatalogCache();
  return result;
}
