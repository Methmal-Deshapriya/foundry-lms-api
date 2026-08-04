import * as categoryRepo from "../../../repositories/v1/catalog/category.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  courseAdminFiltersSchema,
  createCourseSchema,
  updateCourseSchema,
} from "../../../constants/v1/catalog/course.schema.js";
import { CATALOG_STATUSES } from "../../../constants/v1/catalog/catalog.constants.js";
import { toAdminCourse } from "../../../models/v1/catalog/catalog.model.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { recordActionService } from "../audit/audit.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";

function parseOrThrow(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return validation.data;
}

function validateMergedCourse(current, input) {
  const durationValue = input.durationValue !== undefined
    ? input.durationValue
    : current.durationValue;
  const durationUnit = input.durationUnit !== undefined
    ? input.durationUnit
    : current.durationUnit;
  if ((durationValue == null) !== (durationUnit == null)) {
    throw new ValidationError(
      "Duration value and unit must be provided together.",
      "durationValue",
    );
  }
  const accessType = input.accessType ?? current.accessType;
  const price = input.price ?? Number(current.price);
  if (accessType === "FREE" && price !== 0) {
    throw new ValidationError("Free courses must have a zero price.", "price");
  }
}

export async function getCoursesAdminService(query) {
  const filters = parseOrThrow(courseAdminFiltersSchema, query);
  const { limit, offset, ...where } = filters;
  const result = await courseRepo.findAdmin(where, limit, offset);
  return {
    courses: result.courses.map(toAdminCourse),
    pagination: { total: result.total, limit, offset },
  };
}

export async function getCourseAdminService(id) {
  const course = await courseRepo.findById(id);
  if (!course) throw new NotFoundError("Course not found.");
  return toAdminCourse(course);
}

export async function createCourseService(data, actorId) {
  const input = parseOrThrow(createCourseSchema, data);
  const category = await categoryRepo.findById(input.categoryId);
  if (!category) throw new NotFoundError("Category not found.");
  if (category.status === CATALOG_STATUSES.ARCHIVED) {
    throw new ConflictError("Courses cannot be created under an archived category.");
  }
  const course = await courseRepo.create({
    ...input,
    status: CATALOG_STATUSES.DRAFT,
  });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_CREATED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: course.id,
    description: `Course "${course.title}" created as a draft.`,
    metadata: { categoryId: course.categoryId, slug: course.slug },
  });
  return toAdminCourse(course);
}

export async function updateCourseService(id, data, actorId) {
  const input = parseOrThrow(updateCourseSchema, data);
  const current = await courseRepo.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  if (current.status === CATALOG_STATUSES.ARCHIVED) {
    throw new ConflictError("Archived courses cannot be edited.");
  }
  if (
    current.status === CATALOG_STATUSES.PUBLISHED &&
    (input.slug !== undefined || input.categoryId !== undefined)
  ) {
    throw new ConflictError(
      "Published course slugs and categories are immutable. Unpublish it first.",
    );
  }
  if (input.categoryId && input.categoryId !== current.categoryId) {
    const category = await categoryRepo.findById(input.categoryId);
    if (!category) throw new NotFoundError("Category not found.");
    if (category.status === CATALOG_STATUSES.ARCHIVED) {
      throw new ConflictError("Course cannot move to an archived category.");
    }
  }
  validateMergedCourse(current, input);
  const course = await courseRepo.update(id, input);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_UPDATED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: id,
    description: `Course "${course.title}" updated.`,
    metadata: { changedFields: Object.keys(input) },
  });
  if (current.status === CATALOG_STATUSES.PUBLISHED) {
    await revalidatePublicCatalogCache();
  }
  return toAdminCourse(course);
}

export async function setCoursePublicationService(id, publish, actorId) {
  const current = await courseRepo.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  if (current.status === CATALOG_STATUSES.ARCHIVED) {
    throw new ConflictError("Archived courses cannot be published.");
  }
  if (publish && current.category.status !== CATALOG_STATUSES.PUBLISHED) {
    throw new ConflictError("Publish the parent category before publishing this course.");
  }
  validateMergedCourse(current, {});
  const status = publish ? CATALOG_STATUSES.PUBLISHED : CATALOG_STATUSES.DRAFT;
  const course = await courseRepo.update(id, { status });
  recordActionService({
    actorUserId: actorId,
    action: publish
      ? AUDIT_ACTIONS.COURSE_PUBLISHED
      : AUDIT_ACTIONS.COURSE_UNPUBLISHED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: id,
    description: `Course "${course.title}" ${publish ? "published" : "unpublished"}.`,
  });
  await revalidatePublicCatalogCache();
  return toAdminCourse(course);
}

export async function archiveCourseService(id, actorId) {
  const current = await courseRepo.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  if (current.status === CATALOG_STATUSES.ARCHIVED) return toAdminCourse(current);
  const course = await courseRepo.update(id, { status: CATALOG_STATUSES.ARCHIVED });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_ARCHIVED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: id,
    description: `Course "${course.title}" archived.`,
  });
  if (current.status === CATALOG_STATUSES.PUBLISHED) {
    await revalidatePublicCatalogCache();
  }
  return toAdminCourse(course);
}
