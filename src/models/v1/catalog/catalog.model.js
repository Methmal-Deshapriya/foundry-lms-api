import { resolveThumbnailUrl, toStoredObjectSummary } from "../../../utils/thumbnails.js";

const LEVEL_LABELS = {
  OPEN: "Open",
  FOUNDATION: "Foundation",
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

function formatDuration(value, unit) {
  if (!value || !unit) return null;
  const label = unit.toLowerCase();
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

export function toPublicCourseCard(course) {
  const service = course.service;
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    summary: course.summary,
    level: course.level,
    levelLabel: LEVEL_LABELS[course.level],
    durationValue: course.durationValue,
    durationUnit: course.durationUnit,
    durationLabel: formatDuration(course.durationValue, course.durationUnit),
    accessType: service?.accessType,
    instanceKind: service?.courseMode,
    price: Number(course.price),
    currency: course.currency,
    certificateEnabled: course.certificateEnabled,
    enrollmentStatus: course.enrollmentStatus,
    thumbnailUrl: resolveThumbnailUrl(course),
  };
}

// The flat cross-service Explore listing needs to link/label each card on
// its own, since (unlike the per-service browse path) the page doesn't
// already know which service a given card belongs to.
export function toPublicExploreCourseCard(course) {
  return {
    ...toPublicCourseCard(course),
    serviceSlug: course.service?.slug,
    serviceTitle: course.service?.title,
  };
}

export function toPublicCourseDetail(course) {
  const openIntake = course.intakes?.[0];
  return {
    ...toPublicCourseCard(course),
    description: course.description,
    highlights: course.highlights,
    skills: course.skills,
    prerequisites: course.prerequisites,
    thumbnailUrl: resolveThumbnailUrl(course),
    service: { slug: course.service?.slug, title: course.service?.title },
    openIntake: openIntake
      ? {
          id: openIntake.id,
          startDate: openIntake.startDate,
          expectedEndDate: openIntake.expectedEndDate,
          capacity: openIntake.capacity,
          // null capacity means unlimited — seatsRemaining stays null too so
          // the public page can tell "unlimited" apart from "0 left" (Finding
          // G of the 2026-08-30 system guide/audit). Never negative even if
          // capacity was lowered below the current enrolled count.
          seatsRemaining:
            openIntake.capacity == null
              ? null
              : Math.max(openIntake.capacity - (openIntake._count?.enrollments ?? 0), 0),
        }
      : null,
  };
}

export function toAdminIntake(intake) {
  const service = intake.service;
  return {
    ...intake,
    accessType: service?.accessType,
    instanceKind: service?.courseMode,
    certificateEnabled: intake.course?.certificateEnabled,
    course: intake.course
      ? { ...intake.course, discountAmount: Number(intake.course.discountAmount), price: Number(intake.course.price) }
      : intake.course,
    sessionCount: intake._count?.courseSessions ?? 0,
    enrollmentCount: intake._count?.enrollments ?? 0,
    projectCount: intake._count?.studentProjects ?? 0,
    _count: undefined,
  };
}

export function toAdminCourse(course) {
  return {
    ...course,
    thumbnailUrl: resolveThumbnailUrl(course),
    thumbnailObject: toStoredObjectSummary(course.thumbnailObject, resolveThumbnailUrl(course)),
    price: Number(course.price),
    discountAmount: Number(course.discountAmount),
    intakes: Array.isArray(course.intakes)
      ? course.intakes.map(toAdminIntake)
      : [],
    intakeCount: course._count?.intakes ?? course.intakes?.length ?? 0,
    _count: undefined,
  };
}
