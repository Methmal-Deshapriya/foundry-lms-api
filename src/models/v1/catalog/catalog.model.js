import { COURSE_LEVELS } from "../../../constants/v1/catalog/catalog.constants.js";

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

function formatLevelSummary(levels) {
  const ordered = COURSE_LEVELS.filter((level) => levels.includes(level));
  if (ordered.length === 0) return null;
  if (ordered.length === 1) return `${LEVEL_LABELS[ordered[0]]} level`;
  return `${LEVEL_LABELS[ordered[0]]} to ${LEVEL_LABELS[ordered.at(-1)]}`;
}

export function toPublicCategory(category) {
  const levels = category.courses?.map((course) => course.level) ?? [];
  return {
    id: category.id,
    serviceId: category.serviceId,
    serviceType: category.service.key,
    serviceSlug: category.service.slug,
    serviceTitle: category.service.title,
    slug: category.slug,
    title: category.title,
    description: category.description,
    audienceLabel: category.audienceLabel,
    visualKey: category.visualKey,
    badgeLabel: category.badgeLabel,
    sortOrder: category.sortOrder,
    courseCount: category._count?.courses ?? levels.length,
    levelSummary: formatLevelSummary(levels),
  };
}

export function toPublicCourseCard(course) {
  const service = course.category?.service;
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
    thumbnailUrl: course.thumbnailUrl,
    category: toPublicCategory(course.category),
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

export function toAdminCategory(category) {
  return {
    ...category,
    courseCount: category._count?.courses ?? 0,
    intakeCount: category._count?.intakes ?? 0,
    courses: undefined,
    _count: undefined,
  };
}

export function toAdminIntake(intake) {
  const service = intake.category?.service;
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
    price: Number(course.price),
    discountAmount: Number(course.discountAmount),
    intakes: Array.isArray(course.intakes)
      ? course.intakes.map(toAdminIntake)
      : [],
    intakeCount: course._count?.intakes ?? course.intakes?.length ?? 0,
    _count: undefined,
  };
}
