import * as curriculumRepo from "../../../repositories/v1/courses/courseCurriculum.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  attachCourseSessionSchema,
  courseCurriculumQuerySchema,
  reorderCourseCurriculumSchema,
} from "../../../constants/v1/courses/courseCurriculum.schema.js";
import {
  AUDIT_ACTIONS,
  ENTITY_TYPES,
} from "../../../constants/v1/audit/audit.constants.js";
import { getLearningServicePolicy } from "../../../constants/v1/catalog/learningServicePolicy.constants.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../utils/Errors.js";
import { recordActionService } from "../audit/audit.service.js";
import { assertCourseAcceptsOperationalChanges } from "../catalog/courseLifecycle.service.js";

function parse(schema, data) {
  const validation = schema.safeParse(data);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new ValidationError(issue?.message ?? "Validation failed.", issue?.path?.[0]);
  }
  return validation.data;
}

function toCurriculumItem(courseSession) {
  return {
    id: courseSession.id,
    courseId: courseSession.courseId,
    orderIndex: courseSession.orderIndex,
    retiredAt: courseSession.retiredAt,
    createdAt: courseSession.createdAt,
    updatedAt: courseSession.updatedAt,
    session: courseSession.session,
    usage: {
      batchCount: courseSession._count?.batchLinks ?? 0,
      completionCount: courseSession._count?.completions ?? 0,
      batches: (courseSession.batchLinks ?? []).map((batchLink) => ({
        batchSessionId: batchLink.id,
        batchId: batchLink.batchId,
        batchName: batchLink.batch.name,
        batchCode: batchLink.batch.code,
        batchStatus: batchLink.batch.status,
        isReleased: batchLink.isReleased,
        availableAt: batchLink.availableAt,
      })),
    },
  };
}

function deliverySummary(course) {
  const policy = getLearningServicePolicy(course.category.serviceType);
  return {
    serviceType: course.category.serviceType,
    deliveryMode: policy?.deliveryMode,
    immediateAvailability: policy?.deliveryMode === "SELF_PACED",
    affectedLearnerCount:
      policy?.deliveryMode === "SELF_PACED" ? course._count?.enrollments ?? 0 : 0,
  };
}

async function requireOperationalCourse(courseId) {
  const course = await courseRepo.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  assertCourseAcceptsOperationalChanges(course);
  return course;
}

export async function getCourseCurriculumService(courseId, query = {}) {
  const course = await courseRepo.findById(courseId);
  if (!course) throw new NotFoundError("Course not found.");
  const { includeRetired } = parse(courseCurriculumQuerySchema, query);
  const curriculum = await curriculumRepo.findByCourseId(courseId, includeRetired);
  return {
    course: {
      id: course.id,
      title: course.title,
      status: course.status,
      category: {
        id: course.category.id,
        title: course.category.title,
        serviceType: course.category.serviceType,
      },
    },
    delivery: deliverySummary(course),
    curriculum: curriculum.map(toCurriculumItem),
  };
}

export async function attachCourseSessionService(courseId, data, actorId) {
  const input = parse(attachCourseSessionSchema, data);
  const course = await requireOperationalCourse(courseId);

  let courseSession;
  let createdSessionId = null;
  if ("session" in input) {
    if (!input.session.recordingUrl) {
      throw new ValidationError(
        "A curriculum session must have a recording URL before it becomes ready.",
        "recordingUrl",
      );
    }
    const result = await curriculumRepo.createAndAttach(
      courseId,
      input.session,
      input.orderIndex,
    );
    courseSession = result.courseSession;
    createdSessionId = result.sessionId;
    recordActionService({
      actorUserId: actorId,
      action: AUDIT_ACTIONS.SESSION_CREATED,
      entityType: ENTITY_TYPES.SESSION,
      entityId: createdSessionId,
      description: `Session "${input.session.title}" created and attached to course "${course.title}".`,
      metadata: { reusePolicy: input.session.reusePolicy, courseId },
    });
  } else {
    courseSession = await curriculumRepo.attachExisting(
      courseId,
      input.sessionId,
      input.orderIndex,
    );
  }

  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_SESSION_ATTACHED,
    entityType: ENTITY_TYPES.COURSE_SESSION,
    entityId: courseSession.id,
    description: `Session "${courseSession.session.title}" attached to course "${course.title}".`,
    metadata: {
      courseId,
      sessionId: courseSession.session.id,
      orderIndex: courseSession.orderIndex,
      createdSessionId,
      ...deliverySummary(course),
    },
  });

  return {
    courseSession: toCurriculumItem(courseSession),
    delivery: deliverySummary(course),
  };
}

export async function reorderCourseCurriculumService(courseId, data, actorId) {
  const { courseSessions, acknowledgeSequenceRisk } = parse(
    reorderCourseCurriculumSchema,
    data,
  );
  const ids = courseSessions.map(({ id }) => id);
  const indexes = courseSessions.map(({ orderIndex }) => orderIndex);
  const expected = courseSessions.map((_, index) => index);
  if (
    new Set(ids).size !== ids.length ||
    new Set(indexes).size !== indexes.length ||
    [...indexes].sort((left, right) => left - right).some(
      (value, index) => value !== expected[index],
    )
  ) {
    throw new ValidationError(
      "Course sessions must be unique and use continuous order indexes from zero.",
      "courseSessions",
    );
  }

  const course = await requireOperationalCourse(courseId);
  const impact = await curriculumRepo.reorder(
    courseId,
    courseSessions,
    acknowledgeSequenceRisk,
  );
  recordActionService({
    actorUserId: actorId,
    action: AUDIT_ACTIONS.COURSE_CURRICULUM_REORDERED,
    entityType: ENTITY_TYPES.COURSE,
    entityId: courseId,
    description: `Curriculum reordered for course "${course.title}".`,
    metadata: {
      courseSessionIds: ids,
      acknowledgeSequenceRisk,
      ...impact,
      ...deliverySummary(course),
    },
  });
  return { success: true, ...impact };
}

export async function removeCourseSessionService(
  courseId,
  courseSessionId,
  actorId,
) {
  const course = await requireOperationalCourse(courseId);
  const courseSession = await curriculumRepo.findById(courseSessionId);
  if (!courseSession || courseSession.courseId !== courseId) {
    throw new NotFoundError("Course session not found.");
  }
  if (
    course.category.serviceType === "FREE_LEARNING" &&
    course.enrollmentStatus === "OPEN" &&
    !courseSession.retiredAt &&
    course._count.courseSessions === 1
  ) {
    throw new ConflictError(
      "Move enrollment to Coming soon or Closed before removing the final active session.",
    );
  }

  const result = await curriculumRepo.removeOrRetire(
    courseSessionId,
    course.category.serviceType,
  );
  recordActionService({
    actorUserId: actorId,
    action:
      result.action === "RETIRED"
        ? AUDIT_ACTIONS.COURSE_SESSION_RETIRED
        : AUDIT_ACTIONS.COURSE_SESSION_DETACHED,
    entityType: ENTITY_TYPES.COURSE_SESSION,
    entityId: courseSessionId,
    description: `Session "${courseSession.session.title}" ${
      result.action === "RETIRED" ? "retired from" : "detached from"
    } course "${course.title}".`,
    metadata: {
      courseId,
      sessionId: courseSession.session.id,
      action: result.action,
      ...deliverySummary(course),
    },
  });
  return result;
}
