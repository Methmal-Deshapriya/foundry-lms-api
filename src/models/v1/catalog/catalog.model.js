import { COURSE_LEVELS, SERVICE_TYPE_TO_SLUG } from "../../../constants/v1/catalog/catalog.constants.js";

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
    serviceType: category.serviceType,
    serviceSlug: SERVICE_TYPE_TO_SLUG[category.serviceType],
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
    accessType: course.accessType,
    price: Number(course.price),
    currency: course.currency,
    certificateEnabled: course.certificateEnabled,
  };
}

export function toPublicCourseDetail(course) {
  return {
    ...toPublicCourseCard(course),
    description: course.description,
    highlights: course.highlights,
    skills: course.skills,
    prerequisites: course.prerequisites,
    thumbnailUrl: course.thumbnailUrl,
    category: toPublicCategory(course.category),
  };
}

export function toAdminCategory(category) {
  return {
    ...category,
    courseCount: category._count?.courses ?? 0,
    courses: undefined,
    _count: undefined,
  };
}

export function toAdminCourse(course) {
  return {
    ...course,
    price: Number(course.price),
    sessionCount: course._count?.sessions ?? 0,
    enrollmentCount: course._count?.enrollments ?? 0,
    _count: undefined,
  };
}
