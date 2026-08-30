import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import {
  intakeAdminFiltersSchema,
  intakeStatusSchema,
  createIntakeSchema,
  updateIntakeSchema,
} from "../../../constants/v1/catalog/intake.schema.js";
import { toAdminIntake } from "../../../models/v1/catalog/catalog.model.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";
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

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

export async function listIntakesAdminService(query) {
  const { limit, offset, ...filters } = parse(intakeAdminFiltersSchema, query);
  const result = await intakeRepository.findAdmin(filters, limit, offset);
  return { intakes: result.intakes.map(toAdminIntake), pagination: { total: result.total, limit, offset } };
}

export async function getIntakeAdminService(id) {
  const intake = await intakeRepository.findById(id);
  if (!intake) throw new NotFoundError("Intake not found.");
  return toAdminIntake(intake);
}

/** Pre-fills the create-intake form per the rename plan §3a. */
export async function getIntakeDefaultsService(courseId) {
  const course = await courseRepository.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  return intakeRepository.suggestIntakeDefaults(courseId);
}

export async function createIntakeService(courseId, data, actorId) {
  const input = parse(createIntakeSchema, data);
  const course = await courseRepository.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  if (course.archivedAt) throw new ConflictError("Course is archived.");

  const defaults = await intakeRepository.suggestIntakeDefaults(courseId);
  const intakeKey = input.intakeKey ?? defaults.intakeKey;
  const timezone = input.timezone ?? defaults.timezone;

  if (course.category.service.courseMode === "SEASONAL") {
    if (!input.startDate || !input.expectedEndDate) throw new ValidationError("Seasonal intakes require start and expected end dates.", "startDate");
  } else if (input.startDate != null || input.expectedEndDate != null) {
    throw new ValidationError("Evergreen intakes do not use intake dates.", "startDate");
  }

  const intake = await intakeRepository.create(courseId, { ...input, intakeKey, timezone });
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.INTAKE_CREATED,
    entityType: ENTITY_TYPES.INTAKE,
    entityId: intake.id,
    description: `Intake "${intake.code}" created as Draft under course "${course.title}".`,
    metadata: { courseId, intakeKey: intake.intakeKey },
  });
  return toAdminIntake(await intakeRepository.findById(intake.id));
}

export async function updateIntakeService(id, data, actorId) {
  const input = parse(updateIntakeSchema, data);
  const current = await intakeRepository.findById(id);
  if (!current) throw new NotFoundError("Intake not found.");
  if (current.category.service.courseMode === "SEASONAL") {
    const nextStart = input.startDate === undefined ? current.startDate : input.startDate;
    const nextEnd = input.expectedEndDate === undefined ? current.expectedEndDate : input.expectedEndDate;
    if (!nextStart || !nextEnd || nextEnd <= nextStart) {
      throw new ValidationError("Seasonal intake dates are required and the expected end date must be after the start date.", "expectedEndDate");
    }
  } else if (input.startDate != null || input.expectedEndDate != null) {
    throw new ValidationError("Evergreen intakes do not use intake dates.", "startDate");
  }
  const intake = await intakeRepository.updateSetup(id, input);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.INTAKE_UPDATED, entityType: ENTITY_TYPES.INTAKE, entityId: id, description: `Intake ${intake.code} updated.`, metadata: { changedFields: Object.keys(input) } });
  return toAdminIntake(intake);
}

export async function updateIntakeStatusService(id, data, actor) {
  const { status, expectedStatus } = parse(intakeStatusSchema, data);
  if (!ALLOWED_TRANSITIONS[expectedStatus]?.includes(status)) throw new ConflictError(`Intake cannot move from ${expectedStatus} to ${status}.`, "INVALID_INTAKE_TRANSITION");
  if (["OPEN_ACTIVE", "CLOSED_ACTIVE", "ARCHIVED"].includes(status) && !hasPermission(actor.role, PERMISSIONS.CATALOG_PUBLISH)) {
    throw new ForbiddenError("Only a Super Admin can expose, close, or archive an intake.", "INSUFFICIENT_INTAKE_LIFECYCLE_AUTHORITY");
  }
  const intake = await intakeRepository.transitionStatus(id, expectedStatus, status);
  if (!intake) throw new NotFoundError("Intake not found.");
  recordActionService({ actorUserId: actor.id, action: AUDIT_ACTIONS.INTAKE_STATUS_CHANGED, entityType: ENTITY_TYPES.INTAKE, entityId: id, description: `Intake ${intake.code} moved from ${expectedStatus} to ${status}.`, metadata: { from: expectedStatus, to: status, courseId: intake.courseId } });
  if ([expectedStatus, status].includes("OPEN_ACTIVE")) await revalidatePublicCatalogCache();
  return toAdminIntake(intake);
}

function countByKey(groups, key, value) {
  return groups.find((row) => row[key] === value)?._count ?? 0;
}

function paymentTypeBreakdown(groups, type) {
  const row = groups.find((entry) => entry.type === type);
  return { count: row?._count ?? 0, amount: row ? Number(row._sum.amount ?? 0) : 0 };
}

export async function getIntakeAnalyticsService(intakeId) {
  const data = await intakeRepository.getAnalytics(intakeId);
  if (!data) throw new NotFoundError("Intake not found.");
  const {
    intake,
    statusGroups,
    revenueAgg,
    paymentTypeGroups,
    districtRows,
    sessionRows,
    projectGroups,
    certificatesIssuedCount,
    eligibleEnrollmentCount,
  } = data;

  const active = countByKey(statusGroups, "status", "ACTIVE");
  const completed = countByKey(statusGroups, "status", "COMPLETED");
  const cancelled = countByKey(statusGroups, "status", "CANCELLED");
  const successRateDenominator = active + completed + cancelled;
  // An intake full of only ACTIVE enrollments hasn't produced a single
  // outcome yet — "0%" would read as "everyone failed," when really
  // nobody has finished (or dropped) yet. Gate on settled outcomes
  // specifically, not on the denominator (which active enrollments alone
  // already make nonzero).
  const hasSettledOutcome = completed + cancelled > 0;

  return {
    enrollments: { active, completed, cancelled, capacity: intake.capacity },
    payments: {
      full: paymentTypeBreakdown(paymentTypeGroups, "FULL"),
      partial: paymentTypeBreakdown(paymentTypeGroups, "PARTIAL"),
      topUp: paymentTypeBreakdown(paymentTypeGroups, "TOP_UP"),
    },
    revenue: { total: Number(revenueAgg._sum.amount ?? 0), currency: intake.course.currency },
    successRate: {
      // null (not 0%) until there's at least one settled enrollment —
      // an empty/new intake hasn't "failed," it just hasn't run yet.
      completedPct: hasSettledOutcome ? Math.round((completed / successRateDenominator) * 1000) / 10 : null,
      certificatesIssued: certificatesIssuedCount,
      certificateEligible: intake.course.certificateEnabled ? completed : 0,
    },
    districts: districtRows.map((row) => ({ district: row.district, count: row.count })),
    sessionEngagement: sessionRows.map((row) => ({
      courseSessionId: row.id,
      title: row.session.title,
      orderIndex: row.orderIndex,
      completions: row._count.completions,
      eligible: eligibleEnrollmentCount,
      pct: eligibleEnrollmentCount > 0 ? Math.round((row._count.completions / eligibleEnrollmentCount) * 1000) / 10 : 0,
    })),
    projects: {
      pending: countByKey(projectGroups, "status", "PENDING"),
      approved: countByKey(projectGroups, "status", "APPROVED"),
      rejected: countByKey(projectGroups, "status", "REJECTED"),
    },
  };
}

export async function getIntakeDeletionImpactService(id) {
  const intake = await intakeRepository.findById(id);
  if (!intake) throw new NotFoundError("Intake not found.");
  return {
    resourceType: "INTAKE",
    resourceId: id,
    resourceStatus: intake.status,
    curriculumLinks: intake._count.courseSessions,
    enrollments: intake._count.enrollments,
    projects: intake._count.studentProjects,
    deletable:
      intake.status === "ARCHIVED" &&
      intake._count.courseSessions === 0 &&
      intake._count.enrollments === 0 &&
      intake._count.studentProjects === 0,
  };
}

export async function deleteIntakePermanentlyService(id, actorId) {
  const current = await intakeRepository.findById(id);
  if (!current) throw new NotFoundError("Intake not found.");
  const result = await intakeRepository.removePermanently(id);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.INTAKE_DELETED_PERMANENTLY, entityType: ENTITY_TYPES.INTAKE, entityId: id, description: `Unused intake ${current.code} permanently deleted.` });
  return result;
}
