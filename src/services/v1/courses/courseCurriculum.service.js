import * as repository from "../../../repositories/v1/courses/courseCurriculum.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
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
    courseId: item.courseId,
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

async function requireCourse(id) { const course = await courseRepository.findById(id); if (!course) throw new NotFoundError("Course not found."); return course; }

export async function getCourseCurriculumService(courseId, query = {}) {
  const { includeRetired } = parse(courseCurriculumQuerySchema, query);
  const course = await requireCourse(courseId);
  const curriculum = await repository.findCurriculum(courseId, includeRetired);
  return { course, curriculum: curriculum.map(response) };
}

export async function attachCourseSessionService(courseId, data, actorId) {
  const input = parse(attachCourseSessionSchema, data);
  await requireCourse(courseId);
  const item = await repository.attach(courseId, input.sessionId, input.orderIndex);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_SESSION_ATTACHED, entityType: ENTITY_TYPES.COURSE_SESSION, entityId: item.id, description: `Session "${item.session.title}" attached to course ${courseId}.`, metadata: { courseId, sessionId: input.sessionId } });
  return { courseSession: response(item) };
}

export async function reorderCourseCurriculumService(courseId, data, actorId) {
  const input = parse(reorderCourseCurriculumSchema, data);
  await requireCourse(courseId);
  const sorted = [...input.courseSessions].sort((a, b) => a.orderIndex - b.orderIndex);
  if (sorted.some((item, index) => item.orderIndex !== index)) throw new ValidationError("Order indexes must be continuous from zero.", "courseSessions");
  await repository.reorder(courseId, sorted, input.acknowledgeSequenceRisk);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_CURRICULUM_REORDERED, entityType: ENTITY_TYPES.COURSE, entityId: courseId, description: `Course ${courseId} curriculum reordered.`, metadata: { courseSessionIds: sorted.map(({ id }) => id), sequenceRiskAcknowledged: input.acknowledgeSequenceRisk } });
  return { success: true };
}

export async function removeCourseSessionService(courseId, courseSessionId, actorId) {
  const result = await repository.remove(courseId, courseSessionId);
  recordActionService({ actorUserId: actorId, action: result.action === "RETIRED" ? AUDIT_ACTIONS.COURSE_SESSION_RETIRED : AUDIT_ACTIONS.COURSE_SESSION_DETACHED, entityType: ENTITY_TYPES.COURSE_SESSION, entityId: courseSessionId, description: `Course session ${result.action.toLowerCase()} from course ${courseId}.`, metadata: { courseId } });
  return result;
}

export async function updateCourseSessionDeliveryService(courseId, courseSessionId, data, actorId) {
  const input = parse(updateCourseSessionDeliverySchema, data);
  const item = await repository.updateDelivery(courseId, courseSessionId, input);
  recordActionService({ actorUserId: actorId, action: AUDIT_ACTIONS.COURSE_SESSION_DELIVERY_UPDATED, entityType: ENTITY_TYPES.COURSE_SESSION, entityId: courseSessionId, description: `Course session delivery changed to ${item.deliveryStatus}.`, metadata: { courseId, availableAt: item.availableAt, sequenceRiskAcknowledged: input.acknowledgeSequenceRisk } });
  return response(item);
}
