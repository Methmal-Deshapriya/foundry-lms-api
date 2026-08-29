import * as repository from "../../../repositories/v1/catalog/courseGroup.repository.js";
import * as categoryRepository from "../../../repositories/v1/catalog/category.repository.js";
import {
  courseGroupAdminFiltersSchema,
  createCourseGroupSchema,
  updateCourseGroupSchema,
} from "../../../constants/v1/catalog/courseGroup.schema.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { toAdminCourseGroup } from "../../../models/v1/catalog/catalog.model.js";

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

export async function listCourseGroupsService(query) {
  const { limit, offset, ...filters } = parse(courseGroupAdminFiltersSchema, query);
  const result = await repository.findAdmin(filters, limit, offset);
  return { courseGroups: result.courseGroups.map(toAdminCourseGroup), pagination: { total: result.total, limit, offset } };
}

export async function getCourseGroupService(id) {
  const group = await repository.findById(id);
  if (!group) throw new NotFoundError("Course group not found.");
  return toAdminCourseGroup(group);
}

export async function getCourseGroupDeletionImpactService(id) {
  const impact = await repository.findDeletionImpact(id);
  if (!impact) throw new NotFoundError("Course group not found.");
  return impact;
}

export async function createCourseGroupService(data, actorId) {
  const input = parse(createCourseGroupSchema, data);
  const category = await categoryRepository.findById(input.categoryId);
  if (!category) throw new NotFoundError("Category not found.");
  if (category.status === "ARCHIVED") throw new ConflictError("Category is archived.");
  const group = await repository.create(input);
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_GROUP_CREATED,
    entityType: ENTITY_TYPES.COURSE_GROUP,
    entityId: group.id,
    description: `Course group "${group.title}" created.`,
    metadata: { categoryId: group.categoryId, batchCodePrefix: group.batchCodePrefix },
  });
  return toAdminCourseGroup(group);
}

export async function updateCourseGroupService(id, data, actorId) {
  const input = parse(updateCourseGroupSchema, data);
  const group = await repository.update(id, input);
  if (!group) throw new NotFoundError("Course group not found.");
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_GROUP_UPDATED, entityType: ENTITY_TYPES.COURSE_GROUP, entityId: id, description: `Course group "${group.title}" updated.` });
  return toAdminCourseGroup(group);
}

export async function setCourseGroupArchivedService(id, archived, actorId) {
  const group = await repository.setArchived(id, archived);
  if (!group) throw new NotFoundError("Course group not found.");
  recordActionService({ actorUserId: actorId, action: archived ? AUDIT_ACTIONS.COURSE_GROUP_ARCHIVED : AUDIT_ACTIONS.COURSE_GROUP_UNARCHIVED, entityType: ENTITY_TYPES.COURSE_GROUP, entityId: id, description: `Course group "${group.title}" ${archived ? "archived" : "restored"}.` });
  return toAdminCourseGroup(group);
}

export async function deleteCourseGroupService(id, actorId) {
  const current = await getCourseGroupService(id);
  const result = await repository.remove(id);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_GROUP_DELETED_PERMANENTLY, entityType: ENTITY_TYPES.COURSE_GROUP, entityId: id, description: `Unused course group "${current.title}" permanently deleted.` });
  return result;
}
