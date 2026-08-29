import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import * as groupRepository from "../../../repositories/v1/catalog/courseGroup.repository.js";
import {
  courseAdminFiltersSchema,
  courseStatusSchema,
  createCourseSchema,
  updateCourseSchema,
} from "../../../constants/v1/catalog/course.schema.js";
import { toAdminCourse } from "../../../models/v1/catalog/catalog.model.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
import { COURSE_CURRENCY } from "../../../constants/v1/catalog/catalog.constants.js";
import { hasPermission, PERMISSIONS } from "../../../constants/v1/auth/permissions.constants.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";

const ALLOWED_TRANSITIONS = Object.freeze({
  DRAFT: ["OPEN_ACTIVE", "CANCELLED"],
  OPEN_ACTIVE: ["CLOSED_ACTIVE", "CANCELLED"],
  CLOSED_ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
});

const PUBLIC_FIELDS = [
  "summary", "description", "level", "durationValue", "durationUnit",
  "price", "highlights", "skills",
  "prerequisites", "thumbnailUrl", "sortOrder",
];

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

function requiredFirstCourseFields(input) {
  for (const field of ["summary", "description", "level", "price"]) {
    if (input[field] === undefined) throw new ValidationError(`${field} is required for the first intake.`, field);
  }
}

function validateServiceCourse(group, input) {
  const policy = group.category.service;
  if (policy.accessType === "FREE" && Number(input.price) !== 0) throw new ValidationError("Free Learning courses must have zero price.", "price");
  if (policy.accessType === "PAID" && Number(input.price) <= 0) throw new ValidationError("Paid courses must have a price greater than zero.", "price");
  if (policy.courseMode === "SEASONAL" && (!input.startDate || !input.expectedEndDate)) throw new ValidationError("Seasonal courses require start and expected end dates.", "startDate");
  if (policy.courseMode === "EVERGREEN" && (input.startDate != null || input.expectedEndDate != null)) throw new ValidationError("Evergreen courses do not use intake dates.", "startDate");
}

export async function getCoursesAdminService(query) {
  const { limit, offset, ...filters } = parse(courseAdminFiltersSchema, query);
  const result = await courseRepository.findAdmin(filters, limit, offset);
  return { courses: result.courses.map(toAdminCourse), pagination: { total: result.total, limit, offset } };
}

export async function getCourseAdminService(id) {
  const course = await courseRepository.findById(id);
  if (!course) throw new NotFoundError("Course not found.");
  return toAdminCourse(course);
}

export async function createCourseService(data, actorId) {
  const input = parse(createCourseSchema, data);
  const group = await groupRepository.findById(input.courseGroupId);
  if (!group) throw new NotFoundError("Course group not found.");
  if (group.archivedAt) throw new ConflictError("Course group is archived.");

  let publicData;
  if (input.sourceCourseId) {
    const source = await courseRepository.findById(input.sourceCourseId);
    if (!source || source.courseGroupId !== group.id) throw new ConflictError("Source course must belong to this course group.");
    publicData = Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, source[field]]));
  } else {
    if (group.courses.length > 0) throw new ConflictError("Create later intakes by copying an existing course.");
    requiredFirstCourseFields(input);
    publicData = Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, input[field]]));
  }
  validateServiceCourse(group, { ...input, ...publicData });
  const course = await courseRepository.create({
    courseGroupId: group.id,
    categoryId: group.categoryId,
    slug: group.slug,
    title: group.title,
    intakeKey: input.intakeKey,
    code: `${group.batchCodePrefix}-${input.intakeKey}`,
    startDate: input.startDate ?? null,
    expectedEndDate: input.expectedEndDate ?? null,
    timezone: input.timezone,
    capacity: input.capacity ?? null,
    ...publicData,
    currency: COURSE_CURRENCY,
    status: "DRAFT",
  }, input.sourceCourseId ?? null);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_CREATED, entityType: ENTITY_TYPES.COURSE, entityId: course.id, description: `Course intake "${course.title}" (${course.code}) created as Draft.`, metadata: { courseGroupId: group.id, intakeKey: course.intakeKey, sourceCourseId: input.sourceCourseId ?? null } });
  return toAdminCourse(await courseRepository.findById(course.id));
}

export async function updateCourseService(id, data, actorId) {
  const input = parse(updateCourseSchema, data);
  const current = await courseRepository.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  if (current.category.service.courseMode === "SEASONAL") {
    const nextStart = input.startDate === undefined ? current.startDate : input.startDate;
    const nextEnd = input.expectedEndDate === undefined ? current.expectedEndDate : input.expectedEndDate;
    if (!nextStart || !nextEnd || nextEnd <= nextStart) {
      throw new ValidationError("Seasonal course dates are required and the expected end date must be after the start date.", "expectedEndDate");
    }
  } else if (input.startDate != null || input.expectedEndDate != null) {
    throw new ValidationError("Evergreen courses do not use intake dates.", "startDate");
  }
  const course = await courseRepository.updateSetup(id, input);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_UPDATED, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Course intake ${course.code} updated.`, metadata: { changedFields: Object.keys(input) } });
  return toAdminCourse(course);
}

export async function updateCourseStatusService(id, data, actor) {
  const { status, expectedStatus } = parse(courseStatusSchema, data);
  if (!ALLOWED_TRANSITIONS[expectedStatus]?.includes(status)) throw new ConflictError(`Course cannot move from ${expectedStatus} to ${status}.`, "INVALID_COURSE_TRANSITION");
  if (["OPEN_ACTIVE", "CLOSED_ACTIVE", "ARCHIVED"].includes(status) && !hasPermission(actor.role, PERMISSIONS.CATALOG_PUBLISH)) {
    throw new ForbiddenError("Only a Super Admin can expose, close, or archive a course intake.", "INSUFFICIENT_COURSE_LIFECYCLE_AUTHORITY");
  }
  const course = await courseRepository.transitionStatus(id, expectedStatus, status);
  if (!course) throw new NotFoundError("Course not found.");
  recordActionService({ actorUserId: actor.id, action: AUDIT_ACTIONS.COURSE_STATUS_CHANGED, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Course intake ${course.code} moved from ${expectedStatus} to ${status}.`, metadata: { from: expectedStatus, to: status, courseGroupId: course.courseGroupId } });
  if ([expectedStatus, status].includes("OPEN_ACTIVE")) await revalidatePublicCatalogCache();
  return toAdminCourse(course);
}

export async function getCourseDeletionImpactService(id) {
  const course = await courseRepository.findById(id);
  if (!course) throw new NotFoundError("Course not found.");
  return {
    resourceType: "COURSE",
    resourceId: id,
    resourceStatus: course.status,
    curriculumLinks: course._count.courseSessions,
    enrollments: course._count.enrollments,
    projects: course._count.studentProjects,
    deletable:
      course.status === "ARCHIVED" &&
      course._count.courseSessions === 0 &&
      course._count.enrollments === 0 &&
      course._count.studentProjects === 0,
  };
}

export async function deleteCoursePermanentlyService(id, actorId) {
  const current = await courseRepository.findById(id);
  if (!current) throw new NotFoundError("Course not found.");
  const result = await courseRepository.removePermanently(id);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_DELETED_PERMANENTLY, entityType: ENTITY_TYPES.COURSE, entityId: id, description: `Unused course intake ${current.code} permanently deleted.` });
  return result;
}
