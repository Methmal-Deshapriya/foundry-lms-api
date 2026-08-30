import * as repository from "../../../repositories/v1/catalog/course.repository.js";
import * as categoryRepository from "../../../repositories/v1/catalog/category.repository.js";
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

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

function validatePricingPolicy(category, price) {
  const accessType = category.service.accessType;
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

export async function createCourseService(data, actorId) {
  const input = parse(createCourseSchema, data);
  const category = await categoryRepository.findById(input.categoryId);
  if (!category) throw new NotFoundError("Category not found.");
  if (category.status === "ARCHIVED") throw new ConflictError("Category is archived.");
  validatePricingPolicy(category, input.price);
  const course = await repository.create({ ...input, currency: COURSE_CURRENCY });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_CREATED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: course.id,
    description: `Course "${course.title}" created.`,
    metadata: { categoryId: course.categoryId, intakeCodePrefix: course.intakeCodePrefix },
  });
  return toAdminCourse(course);
}

export async function updateCourseService(id, data, actorId) {
  const input = parse(updateCourseSchema, data);
  const current = await repository.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  if (input.price !== undefined) validatePricingPolicy(current.category, input.price);
  const course = await repository.update(id, input);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_UPDATED, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Course "${course.title}" updated.`, metadata: { changedFields: Object.keys(input) } });
  return toAdminCourse(course);
}

export async function setCourseArchivedService(id, archived, actorId) {
  const course = await repository.setArchived(id, archived);
  if (!course) throw new NotFoundError("Course not found.");
  recordActionService({ actorUserId: actorId, action: archived ? AUDIT_ACTIONS.COURSE_ARCHIVED : AUDIT_ACTIONS.COURSE_UNARCHIVED, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Course "${course.title}" ${archived ? "archived" : "restored"}.` });
  return toAdminCourse(course);
}

export async function deleteCourseService(id, actorId) {
  const current = await getCourseAdminService(id);
  const result = await repository.remove(id);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_DELETED_PERMANENTLY, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Unused course "${current.title}" permanently deleted.` });
  return result;
}
