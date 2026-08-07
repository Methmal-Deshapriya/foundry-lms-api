export const LEARNING_SERVICE_TYPES = Object.freeze({
  BOOTCAMPS: "BOOTCAMPS",
  PRETECH: "PRETECH",
  FREE_LEARNING: "FREE_LEARNING",
});

export const SERVICE_SLUG_TO_TYPE = Object.freeze({
  bootcamps: LEARNING_SERVICE_TYPES.BOOTCAMPS,
  "pretech-courses": LEARNING_SERVICE_TYPES.PRETECH,
  "free-learning": LEARNING_SERVICE_TYPES.FREE_LEARNING,
});

export const SERVICE_TYPE_TO_SLUG = Object.freeze(
  Object.fromEntries(
    Object.entries(SERVICE_SLUG_TO_TYPE).map(([slug, type]) => [type, slug]),
  ),
);

export const CATALOG_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
});

export const COURSE_LEVELS = Object.freeze([
  "OPEN",
  "FOUNDATION",
  "BEGINNER",
  "INTERMEDIATE",
  "ADVANCED",
]);

export const COURSE_ACCESS_TYPES = Object.freeze(["FREE", "PAID"]);
export const DURATION_UNITS = Object.freeze([
  "SESSION",
  "DAY",
  "WEEK",
  "MONTH",
]);

export const VISUAL_KEYS = Object.freeze([
  "sparkles",
  "cpu",
  "code2",
  "workflow",
  "calculator",
  "atom",
  "bar-chart3",
  "terminal",
  "git-branch",
  "globe",
  "languages",
]);
