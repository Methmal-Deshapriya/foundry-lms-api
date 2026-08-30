import * as repository from "../../../repositories/v1/courses/courseCurriculum.repository.js";
import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import {
  attachCourseSessionSchema,
  courseCurriculumQuerySchema,
  reorderCourseCurriculumSchema,
  updateCourseSessionDeliverySchema,
} from "../../../constants/v1/courses/courseCurriculum.schema.js";
import { NotFoundError, ValidationError } from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../../../constants/v1/audit/audit.constants.js";

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) { const issue = result.error.issues[0]; throw new ValidationError(issue.message, issue.path[0]); }
  return result.data;
}

function response(item) {
  return {
    id: item.id,
    intakeId: item.intakeId,
    orderIndex: item.orderIndex,
    deliveryStatus: item.deliveryStatus,
    availableAt: item.availableAt,
    firstReleasedAt: item.firstReleasedAt,
    retiredAt: item.retiredAt,
    historicalOrderIndex: item.historicalOrderIndex,
    session: item.session,
    usage: { completionCount: item._count?.completions ?? 0 },
  };
}

async function requireIntake(id) { const intake = await intakeRepository.findById(id); if (!intake) throw new NotFoundError("Intake not found."); return intake; }

export async function getCourseCurriculumService(intakeId, query = {}) {
  const { includeRetired } = parse(courseCurriculumQuerySchema, query);
  const intake = await requireIntake(intakeId);
  const curriculum = await repository.findCurriculum(intakeId, includeRetired);
  return { intake, curriculum: curriculum.map(response) };
}

export async function attachCourseSessionService(intakeId, data, actorId) {
  const input = parse(attachCourseSessionSchema, data);
  await requireIntake(intakeId);
  const item = await repository.attach(intakeId, input.sessionId, input.orderIndex);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_SESSION_ATTACHED, entityType: ENTITY_TYPES.COURSE_SESSION, entityId: item.id, description: `Session "${item.session.title}" attached to intake ${intakeId}.`, metadata: { intakeId, sessionId: input.sessionId } });
  return { courseSession: response(item) };
}

export async function reorderCourseCurriculumService(intakeId, data, actorId) {
  const input = parse(reorderCourseCurriculumSchema, data);
  await requireIntake(intakeId);
  const sorted = [...input.courseSessions].sort((a, b) => a.orderIndex - b.orderIndex);
  if (sorted.some((item, index) => item.orderIndex !== index)) throw new ValidationError("Order indexes must be continuous from zero.", "courseSessions");
  await repository.reorder(intakeId, sorted, input.acknowledgeSequenceRisk);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_CURRICULUM_REORDERED, entityType: ENTITY_TYPES.INTAKE, entityId: intakeId, description: `Intake ${intakeId} curriculum reordered.`, metadata: { courseSessionIds: sorted.map(({ id }) => id), sequenceRiskAcknowledged: input.acknowledgeSequenceRisk } });
  return { success: true };
}

export async function removeCourseSessionService(intakeId, courseSessionId, actorId) {
  const result = await repository.remove(intakeId, courseSessionId);
  recordActionService({ actorUserId: actorId, action: result.action === "RETIRED" ? AUDIT_ACTIONS.COURSE_SESSION_RETIRED : AUDIT_ACTIONS.COURSE_SESSION_DETACHED, entityType: ENTITY_TYPES.COURSE_SESSION, entityId: courseSessionId, description: `Course session ${result.action.toLowerCase()} from intake ${intakeId}.`, metadata: { intakeId } });
  return result;
}

export async function updateCourseSessionDeliveryService(intakeId, courseSessionId, data, actorId) {
  const input = parse(updateCourseSessionDeliverySchema, data);
  const item = await repository.updateDelivery(intakeId, courseSessionId, input);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_SESSION_DELIVERY_UPDATED, entityType: ENTITY_TYPES.COURSE_SESSION, entityId: courseSessionId, description: `Course session delivery changed to ${item.deliveryStatus}.`, metadata: { intakeId, availableAt: item.availableAt, sequenceRiskAcknowledged: input.acknowledgeSequenceRisk } });
  return response(item);
}
