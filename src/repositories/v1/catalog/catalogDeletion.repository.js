import {
  CatalogDeletionBlockedError,
  ConflictError,
} from "../../../utils/Errors.js";

const OPERATIONAL_BATCH_STATUSES = ["ENROLLING", "ACTIVE"];
const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

function blocker(code, count, message) {
  return { code, count, message };
}

export async function runSerializableCatalogTransaction(database, operation) {
  for (let attempt = 1; attempt <= SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (error?.code !== "P2034") throw error;
      if (attempt === SERIALIZABLE_TRANSACTION_ATTEMPTS) {
        throw new ConflictError(
          "The catalog changed while deletion was being checked. Review the impact and try again.",
        );
      }
    }
  }
  throw new ConflictError("Catalog deletion could not be completed safely.");
}

/**
 * Read-only deletion preflight used by both API impact endpoints and the
 * authoritative transaction check. All counts are aggregate queries so a
 * category does not produce an N+1 query per child course.
 */
export async function buildDeletionImpact(
  database,
  { resourceType, resourceId, resourceStatus, courseIds, sequential = false },
) {
  const uniqueCourseIds = [...new Set(courseIds)].sort();
  const courseWhere = { courseId: { in: uniqueCourseIds } };
  const queries = [
    () => database.course.count({
      where: { id: { in: uniqueCourseIds }, status: { not: "ARCHIVED" } },
    }),
    () => database.batch.count({ where: courseWhere }),
    () => database.batch.count({
      where: {
        ...courseWhere,
        status: { in: OPERATIONAL_BATCH_STATUSES },
      },
    }),
    () => database.enrollment.count({ where: courseWhere }),
    () => database.sessionCompletion.count({ where: courseWhere }),
    () => database.certificate.count({
      where: { enrollment: { courseId: { in: uniqueCourseIds } } },
    }),
    () => database.studentProject.count({ where: courseWhere }),
    () => database.courseSession.count({ where: courseWhere }),
    () => database.courseSession.count({
      where: { ...courseWhere, session: { reusePolicy: "SINGLE_COURSE" } },
    }),
    () => database.courseSession.count({
      where: { ...courseWhere, session: { reusePolicy: "REUSABLE" } },
    }),
  ];
  const counts = [];
  if (sequential) {
    for (const query of queries) counts.push(await query());
  } else {
    counts.push(...(await Promise.all(queries.map((query) => query()))));
  }
  const [
    unarchivedCourses,
    batches,
    operationalBatches,
    enrollments,
    completions,
    certificates,
    projects,
    curriculumLinks,
    exclusiveSessions,
    reusableSessions,
  ] = counts;

  const summary = {
    courses: uniqueCourseIds.length,
    unarchivedCourses,
    batches,
    operationalBatches,
    enrollments,
    completions,
    certificates,
    projects,
    curriculumLinks,
    exclusiveSessions,
    reusableSessions,
  };
  const blockers = [];
  if (resourceStatus !== "ARCHIVED") {
    blockers.push(
      blocker(
        "RESOURCE_NOT_ARCHIVED",
        1,
        `Archive this ${resourceType.toLowerCase()} before permanently deleting it.`,
      ),
    );
  }
  if (unarchivedCourses > 0) {
    blockers.push(
      blocker(
        "UNARCHIVED_COURSES",
        unarchivedCourses,
        "Every affected course must be archived before permanent deletion.",
      ),
    );
  }
  if (operationalBatches > 0) {
    blockers.push(
      blocker(
        "OPERATIONAL_BATCHES",
        operationalBatches,
        "Enrolling or active batches must remain available to their learners.",
      ),
    );
  }
  if (enrollments > 0) {
    blockers.push(
      blocker(
        "ENROLLMENT_HISTORY",
        enrollments,
        "Enrollment records are protected learning history, including completed or cancelled enrollments.",
      ),
    );
  }
  if (completions > 0) {
    blockers.push(
      blocker(
        "COMPLETION_HISTORY",
        completions,
        "Session completion records are protected learning history.",
      ),
    );
  }
  if (certificates > 0) {
    blockers.push(
      blocker(
        "CERTIFICATE_HISTORY",
        certificates,
        "Issued or revoked certificates must remain verifiable.",
      ),
    );
  }
  if (projects > 0) {
    blockers.push(
      blocker(
        "PROJECT_HISTORY",
        projects,
        "Submitted student projects are protected learning history.",
      ),
    );
  }

  return {
    resourceType,
    resourceId,
    status: resourceStatus,
    canDelete: blockers.length === 0,
    summary,
    blockers,
  };
}

export function assertDeletionAllowed(impact) {
  if (!impact.canDelete) throw new CatalogDeletionBlockedError(impact);
}

export async function lockArchivedCourses(transaction, courseIds) {
  if (courseIds.length === 0) return;
  const locked = await transaction.course.updateMany({
    where: { id: { in: courseIds }, status: "ARCHIVED" },
    data: { status: "ARCHIVED" },
  });
  if (locked.count !== courseIds.length) {
    throw new ConflictError("Only archived courses can be permanently deleted.");
  }
}

export async function deleteCourseGraph(transaction, courseId) {
  const curriculum = await transaction.courseSession.findMany({
    where: { courseId },
    select: {
      id: true,
      session: { select: { id: true, reusePolicy: true } },
    },
  });
  const singleCourseSessionIds = curriculum
    .filter(({ session }) => session.reusePolicy === "SINGLE_COURSE")
    .map(({ session }) => session.id);
  const preservedReusableSessions = new Set(
    curriculum
      .filter(({ session }) => session.reusePolicy === "REUSABLE")
      .map(({ session }) => session.id),
  ).size;

  const deletedCertificates = await transaction.certificate.count({
    where: { enrollment: { courseId } },
  });
  const deletedCompletions = await transaction.sessionCompletion.count({
    where: { courseId },
  });
  const deletedProjects = (
    await transaction.studentProject.deleteMany({ where: { courseId } })
  ).count;
  const deletedEnrollments = (
    await transaction.enrollment.deleteMany({ where: { courseId } })
  ).count;
  const deletedBatchSessions = (
    await transaction.batchSession.deleteMany({ where: { courseId } })
  ).count;
  const deletedBatches = (
    await transaction.batch.deleteMany({ where: { courseId } })
  ).count;
  const deletedCourseSessions = (
    await transaction.courseSession.deleteMany({ where: { courseId } })
  ).count;
  const deletedExclusiveSessions = singleCourseSessionIds.length
    ? (
        await transaction.session.deleteMany({
          where: {
            id: { in: singleCourseSessionIds },
            reusePolicy: "SINGLE_COURSE",
            courseSessions: { none: {} },
          },
        })
      ).count
    : 0;

  await transaction.course.delete({ where: { id: courseId } });
  return {
    deletedCourses: 1,
    deletedBatches,
    deletedBatchSessions,
    deletedCourseSessions,
    deletedExclusiveSessions,
    preservedReusableSessions,
    deletedEnrollments,
    deletedCompletions,
    deletedCertificates,
    deletedProjects,
  };
}

export function emptyDeletionSummary() {
  return {
    deletedCourses: 0,
    deletedBatches: 0,
    deletedBatchSessions: 0,
    deletedCourseSessions: 0,
    deletedExclusiveSessions: 0,
    preservedReusableSessions: 0,
    deletedEnrollments: 0,
    deletedCompletions: 0,
    deletedCertificates: 0,
    deletedProjects: 0,
  };
}

export function addDeletionSummary(total, current) {
  for (const key of Object.keys(total)) total[key] += current[key] ?? 0;
  return total;
}
