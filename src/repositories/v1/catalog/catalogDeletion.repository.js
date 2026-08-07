import { ConflictError } from "../../../utils/Errors.js";

export async function deleteCourseGraph(transaction, courseId) {
  const locked = await transaction.course.updateMany({
    where: { id: courseId, status: "ARCHIVED" },
    data: { status: "ARCHIVED" },
  });
  if (locked.count !== 1) {
    throw new ConflictError("Only archived courses can be permanently deleted.");
  }

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

  const [deletedCertificates, deletedCompletions] = await Promise.all([
    transaction.certificate.count({ where: { enrollment: { courseId } } }),
    transaction.sessionCompletion.count({ where: { courseId } }),
  ]);
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
